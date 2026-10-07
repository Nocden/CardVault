import cardvault.CardVaultApplet;
import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.AID;

import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import java.math.BigInteger;
import java.security.*;
import java.security.spec.*;
import java.util.Arrays;

/** Runs the applet in jCardSim and checks every rule the card must enforce. */
public class SimTest {
    static final AID AID_APPLET = AIDUtil.create("A000000BEEF00101");
    static CardSimulator sim;
    static int passed = 0;

    public static void main(String[] args) throws Exception {
        sim = new CardSimulator();
        sim.installApplet(AID_APPLET, CardVaultApplet.class);
        sim.selectApplet(AID_APPLET);

        // 1. Public key
        ResponseAPDU r = send(0x10, null);
        expect("GET_PUBKEY", r, 0x9000);
        byte[] w = r.getData();
        check("pubkey is 65-byte uncompressed point", w.length == 65 && w[0] == 0x04);
        PublicKey pub = toJavaKey(w);

        byte[] msgOk = message(0x01, 500_000_000L, 0);      // 0.5 SOL
        byte[] msgBig = message(0x01, 2_000_000_000L, 1);   // 2 SOL

        // 2. Signing needs PIN
        expect("SIGN without PIN", send(0x30, msgOk), 0x6982);

        // 3. Wrong PIN counts down
        expect("wrong PIN", send(0x20, "0000".getBytes()), 0x63C4);

        // 4. Correct PIN + sign + verify signature off-card
        expect("VERIFY_PIN", send(0x20, "1234".getBytes()), 0x9000);
        r = send(0x30, msgOk);
        expect("SIGN 0.5 SOL", r, 0x9000);
        Signature v = Signature.getInstance("SHA256withECDSA");
        v.initVerify(pub);
        v.update(msgOk);
        check("signature verifies with card pubkey (SHA256withECDSA)", v.verify(r.getData()));

        // 5. PIN is consumed by each signature
        expect("SIGN again without PIN", send(0x30, msgOk), 0x6982);

        // 6. On-card limit (default 1 SOL)
        send(0x20, "1234".getBytes());
        expect("SIGN 2 SOL over limit", send(0x30, msgBig), 0x6985);

        // 7. Raise limit, then 2 SOL works
        send(0x20, "1234".getBytes());
        byte[] fiveSol = le64(5_000_000_000L);
        expect("SET_LIMIT 5 SOL", send(0x40, fiveSol), 0x9000);
        send(0x20, "1234".getBytes());
        expect("SIGN 2 SOL after raising limit", send(0x30, msgBig), 0x9000);

        // 8. Recovery messages must have amount = 0, unknown tags rejected
        send(0x20, "1234".getBytes());
        expect("RECOVER with amount != 0", send(0x30, message(0x02, 1, 2)), 0x6A80);
        send(0x20, "1234".getBytes());
        expect("RECOVER with amount = 0", send(0x30, message(0x02, 0, 2)), 0x9000);
        send(0x20, "1234".getBytes());
        expect("unknown tag", send(0x30, message(0x07, 0, 2)), 0x6A81);

        // 9. Wrong length
        send(0x20, "1234".getBytes());
        expect("SIGN wrong length", send(0x30, new byte[10]), 0x6700);

        // 10. GET_INFO
        r = send(0x60, null);
        expect("GET_INFO", r, 0x9000);
        check("limit reported = 5 SOL", Arrays.equals(Arrays.copyOf(r.getData(), 8), fiveSol));

        // 11. Change PIN
        send(0x20, "1234".getBytes());
        expect("CHANGE_PIN", send(0x50, "4321".getBytes()), 0x9000);
        expect("old PIN rejected", send(0x20, "1234".getBytes()), 0x63C4);
        expect("new PIN accepted", send(0x20, "4321".getBytes()), 0x9000);

        // 12. Lockout after 5 wrong tries
        for (int i = 0; i < 4; i++) send(0x20, "0000".getBytes());
        expect("5th wrong PIN blocks", send(0x20, "0000".getBytes()), 0x6983);
        expect("correct PIN after block", send(0x20, "4321".getBytes()), 0x6983);

        System.out.println("\nALL " + passed + " CHECKS PASSED");
    }

    static ResponseAPDU send(int ins, byte[] data) {
        CommandAPDU c = data == null ? new CommandAPDU(0x80, ins, 0, 0, 256)
                                     : new CommandAPDU(0x80, ins, 0, 0, data, 256);
        return sim.transmitCommand(c);
    }

    static void expect(String name, ResponseAPDU r, int sw) {
        check(name + " -> SW " + Integer.toHexString(sw), r.getSW() == sw);
        if (r.getSW() != sw) System.out.println("   got " + Integer.toHexString(r.getSW()));
    }

    static void check(String name, boolean ok) {
        System.out.println((ok ? "  OK   " : "  FAIL ") + name);
        if (!ok) System.exit(1);
        passed++;
    }

    static byte[] message(int tag, long amount, long nonce) {
        byte[] m = new byte[81];
        m[0] = (byte) tag;
        Arrays.fill(m, 1, 33, (byte) 0xAA);  // vault
        Arrays.fill(m, 33, 65, (byte) 0xBB); // recipient
        System.arraycopy(le64(amount), 0, m, 65, 8);
        System.arraycopy(le64(nonce), 0, m, 73, 8);
        return m;
    }

    static byte[] le64(long v) {
        byte[] b = new byte[8];
        for (int i = 0; i < 8; i++) b[i] = (byte) (v >>> (8 * i));
        return b;
    }

    static PublicKey toJavaKey(byte[] w) throws Exception {
        AlgorithmParameters p = AlgorithmParameters.getInstance("EC");
        p.init(new ECGenParameterSpec("secp256r1"));
        ECParameterSpec spec = p.getParameterSpec(ECParameterSpec.class);
        ECPoint pt = new ECPoint(new BigInteger(1, Arrays.copyOfRange(w, 1, 33)),
                                 new BigInteger(1, Arrays.copyOfRange(w, 33, 65)));
        return KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(pt, spec));
    }
}
