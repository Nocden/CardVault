// Talks to the CardVault applet over PC/SC (USB contact reader or a
// PC/SC-capable NFC reader). For phones, the same APDUs go over IsoDep.

export const APPLET_AID = Buffer.from("A000000BEEF00101", "hex");
const CLA = 0x80;
const INS = { GET_PUBKEY: 0x10, VERIFY_PIN: 0x20, SIGN: 0x30, SET_LIMIT: 0x40, CHANGE_PIN: 0x50, GET_INFO: 0x60 };

export interface Transport {
  transmit(apdu: Buffer): Promise<Buffer>; // returns data || SW1 SW2
  close(): void;
}

export class CardError extends Error {
  constructor(public sw: number) {
    super(CardError.describe(sw));
  }
  static describe(sw: number): string {
    if ((sw & 0xfff0) === 0x63c0) return `Wrong PIN, ${sw & 0x0f} tries left`;
    switch (sw) {
      case 0x6982: return "The card needs the PIN first";
      case 0x6983: return "The card is blocked: no PIN tries left";
      case 0x6985: return "Card refused to sign: the amount is above the card's limit";
      case 0x6a80: return "Card refused to sign: invalid request";
      case 0x6a81: return "Card refused to sign: unknown message type";
      case 0x6a82: return "The CardVault applet is not installed on this card";
      case 0x6700: return "Card error: wrong length";
      default: return `Card error ${sw.toString(16).toUpperCase()}`;
    }
  }
}

export class CardVault {
  constructor(private t: Transport) {}

  private async cmd(ins: number, data: Buffer = Buffer.alloc(0), cla = CLA, p1 = 0, p2 = 0): Promise<Buffer> {
    const header = Buffer.from([cla, ins, p1, p2]);
    const apdu = data.length ? Buffer.concat([header, Buffer.from([data.length]), data, Buffer.from([0x00])])
                             : Buffer.concat([header, Buffer.from([0x00])]);
    let res = await this.t.transmit(apdu);
    let sw = res.readUInt16BE(res.length - 2);
    // T=0 contact interface: "61xx" = fetch xx more bytes with GET RESPONSE
    let body = res.subarray(0, -2);
    while ((sw & 0xff00) === 0x6100) {
      res = await this.t.transmit(Buffer.from([0x00, 0xc0, 0x00, 0x00, sw & 0xff]));
      sw = res.readUInt16BE(res.length - 2);
      body = Buffer.concat([body, res.subarray(0, -2)]);
    }
    if (sw !== 0x9000) throw new CardError(sw);
    return body;
  }

  async select(): Promise<void> {
    await this.cmd(0xa4, APPLET_AID, 0x00, 0x04, 0x00);
  }
  /** 65-byte uncompressed P-256 public key. */
  getPubkey(): Promise<Buffer> { return this.cmd(INS.GET_PUBKEY); }
  async verifyPin(pin: string): Promise<void> { await this.cmd(INS.VERIFY_PIN, Buffer.from(pin, "ascii")); }
  /** Signs an 81-byte vault message; returns a DER ECDSA signature. */
  sign(message: Buffer): Promise<Buffer> { return this.cmd(INS.SIGN, message); }
  async setLimit(lamports: bigint): Promise<void> {
    const b = Buffer.alloc(8); b.writeBigUInt64LE(lamports);
    await this.cmd(INS.SET_LIMIT, b);
  }
  async changePin(newPin: string): Promise<void> { await this.cmd(INS.CHANGE_PIN, Buffer.from(newPin, "ascii")); }
  async getInfo(): Promise<{ limit: bigint; pinTries: number }> {
    const r = await this.cmd(INS.GET_INFO);
    return { limit: r.readBigUInt64LE(0), pinTries: r[8] };
  }
}

/** Waits for the first card on any PC/SC reader. */
export async function connectPcsc(timeoutMs = 30_000): Promise<Transport> {
  // Loaded lazily so the simulator works without the native PC/SC module.
  const pcsclite = (await import("@pokusew/pcsclite")).default;
  return new Promise((resolve, reject) => {
    const pcsc = pcsclite();
    const timer = setTimeout(() => { pcsc.close(); reject(new Error("No card in the reader")); }, timeoutMs);
    pcsc.on("error", (e) => { clearTimeout(timer); reject(e); });
    pcsc.on("reader", (reader) => {
      reader.on("status", (status) => {
        const changes = reader.state ^ status.state;
        const present = status.state & reader.SCARD_STATE_PRESENT;
        if (!(changes & reader.SCARD_STATE_PRESENT) || !present) return;
        reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, (err, protocol) => {
          if (err) return reject(err);
          clearTimeout(timer);
          resolve({
            transmit: (apdu) => new Promise((res, rej) =>
              reader.transmit(apdu, 1024, protocol, (e, data) => (e ? rej(e) : res(data)))),
            close: () => { reader.disconnect(() => pcsc.close()); },
          });
        });
      });
    });
  });
}

/** Connects to a simulated card (sim/SimServer.java) over TCP. */
export function connectSim(host: string, port: number): Promise<Transport> {
  return new Promise(async (resolve, reject) => {
    const net = await import("node:net");
    const sock = net.createConnection({ host, port }, () => {
      let buf = "";
      const waiting: ((line: string) => void)[] = [];
      sock.on("data", (d) => {
        buf += d.toString();
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          waiting.shift()?.(line);
        }
      });
      resolve({
        transmit: (apdu) => new Promise((res) => {
          waiting.push((line) => res(Buffer.from(line, "hex")));
          sock.write(apdu.toString("hex") + "\n");
        }),
        close: () => sock.end(),
      });
    });
    sock.on("error", () => reject(new Error(`No simulated card on port ${port}`)));
  });
}

/** CARD=sim:9025 -> simulator, anything else -> real reader via PC/SC. */
export async function openCard(
  spec = process.env.CARD ?? "pcsc",
  timeoutMs = 30_000,
): Promise<{ card: CardVault; close: () => void }> {
  const t = spec.startsWith("sim")
    ? await connectSim(process.env.SIM_HOST ?? "127.0.0.1", Number(spec.split(":")[1] ?? 9025))
    : await connectPcsc(timeoutMs);
  const card = new CardVault(t);
  await card.select();
  return { card, close: () => t.close() };
}
