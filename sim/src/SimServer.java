import cardvault.CardVaultApplet;
import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.AID;

import java.io.*;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.ServerSocket;
import java.net.Socket;

/**
 * One simulated CardVault card exposed over TCP (hex APDU per line).
 * Run two instances (ports 9025 and 9026) to get a main and a recovery card.
 *
 * jCardSim's key generation is deterministic (same key on every simulated
 * card), so we re-seed it per card: seed = "cardvault-sim-<port>" (or SIM_SEED).
 * Same port => same key after a restart, so your vault keeps working.
 */
public class SimServer {
    public static void main(String[] args) throws Exception {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 9025;
        AID aid = AIDUtil.create("A000000BEEF00101");
        CardSimulator sim = new CardSimulator();
        sim.installApplet(aid, CardVaultApplet.class);
        String seed = System.getenv().getOrDefault("SIM_SEED", "cardvault-sim-" + port);
        reseedCardKey(sim, aid, seed);
        System.out.println("Simulated card ready on port " + port + " (PIN 1234, seed '" + seed + "')");

        try (ServerSocket server = new ServerSocket(port)) {
            while (true) {
                try (Socket s = server.accept();
                     BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream()));
                     PrintWriter out = new PrintWriter(s.getOutputStream(), true)) {
                    System.out.println("client connected (card inserted)");
                    String line;
                    while ((line = in.readLine()) != null) {
                        line = line.trim();
                        if (line.isEmpty()) continue;
                        byte[] resp = sim.transmitCommand(hex(line));
                        System.out.println(">> " + line + "\n<< " + toHex(resp));
                        out.println(toHex(resp));
                    }
                } catch (IOException e) {
                    System.out.println("client error: " + e.getMessage());
                }
                // Like pulling the card out of the reader: PIN state is cleared.
                sim.reset();
                System.out.println("client disconnected (card removed)");
            }
        }
    }

    /** Simulator-only: regenerate the applet's key pair from a per-card seed. */
    static void reseedCardKey(CardSimulator sim, AID aid, String seed) throws Exception {
        Field rtField = com.licel.jcardsim.base.Simulator.class.getDeclaredField("runtime");
        rtField.setAccessible(true);
        Object runtime = rtField.get(sim);
        Method getApplet = com.licel.jcardsim.base.SimulatorRuntime.class.getDeclaredMethod("getApplet", AID.class);
        getApplet.setAccessible(true);
        Object applet = getApplet.invoke(runtime, aid);

        Field kpField = CardVaultApplet.class.getDeclaredField("keyPair");
        kpField.setAccessible(true);
        javacard.security.KeyPair kp = (javacard.security.KeyPair) kpField.get(applet);
        // jCardSim wraps javacard.security.KeyPair around a KeyPairImpl ("impl").
        Field implField = kp.getClass().getDeclaredField("impl");
        implField.setAccessible(true);
        Object impl = implField.get(kp);
        Field rndField = impl.getClass().getDeclaredField("rnd");
        rndField.setAccessible(true);
        ((java.security.SecureRandom) rndField.get(impl)).setSeed(seed.getBytes("UTF-8"));
        kp.genKeyPair();

        Field sigField = CardVaultApplet.class.getDeclaredField("signer");
        sigField.setAccessible(true);
        ((javacard.security.Signature) sigField.get(applet)).init(kp.getPrivate(), javacard.security.Signature.MODE_SIGN);
    }

    static byte[] hex(String s) {
        byte[] b = new byte[s.length() / 2];
        for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
        return b;
    }

    static String toHex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02X", x));
        return sb.toString();
    }
}
