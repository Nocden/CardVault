package cardvault;

import javacard.framework.*;
import javacard.security.*;

/**
 * CardVault applet: holds a P-256 key that never leaves the card.
 * Signs 81-byte vault messages only after PIN entry and only if the
 * amount is within the on-card per-transaction limit.
 *
 * Message (81 bytes):
 *   [0]      tag: 0x01 = withdraw, 0x02 = recover (rotate owner)
 *   [1..33)  vault address (32)
 *   [33..65) recipient / new owner (32)
 *   [65..73) amount, u64 little-endian (lamports)
 *   [73..81) nonce,  u64 little-endian
 */
public class CardVaultApplet extends Applet {

    // ---- APDU ----
    private static final byte CLA = (byte) 0x80;
    private static final byte INS_GET_PUBKEY = (byte) 0x10;
    private static final byte INS_VERIFY_PIN = (byte) 0x20;
    private static final byte INS_SIGN       = (byte) 0x30;
    private static final byte INS_SET_LIMIT  = (byte) 0x40;
    private static final byte INS_CHANGE_PIN = (byte) 0x50;
    private static final byte INS_GET_INFO   = (byte) 0x60;

    // ---- status words ----
    private static final short SW_PIN_REQUIRED   = (short) 0x6982;
    private static final short SW_LIMIT_EXCEEDED = (short) 0x6985;
    private static final short SW_PIN_BLOCKED    = (short) 0x6983;
    private static final short SW_BAD_TAG        = (short) 0x6A81;

    // ---- message layout ----
    private static final short MSG_LEN = 81;
    private static final short OFF_TAG = 0;
    private static final short OFF_AMOUNT = 65;
    private static final byte TAG_WITHDRAW = (byte) 0x01;
    private static final byte TAG_RECOVER  = (byte) 0x02;

    // ---- PIN ----
    private static final byte PIN_TRIES = 5;
    private static final byte PIN_MAX_LEN = 8;
    private static final byte PIN_MIN_LEN = 4;

    private final OwnerPIN pin;
    private final KeyPair keyPair;
    private final Signature signer;
    private final byte[] limit;     // u64 LE, persistent
    private final byte[] scratch;   // transient copy of the message

    private static final byte[] P256_P = {
        (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x01,
        (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00,
        (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF,
        (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF
    };
    private static final byte[] P256_A = {
        (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x01,
        (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00,
        (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF,
        (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFC
    };
    private static final byte[] P256_B = {
        (byte)0x5A, (byte)0xC6, (byte)0x35, (byte)0xD8, (byte)0xAA, (byte)0x3A, (byte)0x93, (byte)0xE7,
        (byte)0xB3, (byte)0xEB, (byte)0xBD, (byte)0x55, (byte)0x76, (byte)0x98, (byte)0x86, (byte)0xBC,
        (byte)0x65, (byte)0x1D, (byte)0x06, (byte)0xB0, (byte)0xCC, (byte)0x53, (byte)0xB0, (byte)0xF6,
        (byte)0x3B, (byte)0xCE, (byte)0x3C, (byte)0x3E, (byte)0x27, (byte)0xD2, (byte)0x60, (byte)0x4B
    };
    private static final byte[] P256_G = {
        (byte)0x04, (byte)0x6B, (byte)0x17, (byte)0xD1, (byte)0xF2, (byte)0xE1, (byte)0x2C, (byte)0x42,
        (byte)0x47, (byte)0xF8, (byte)0xBC, (byte)0xE6, (byte)0xE5, (byte)0x63, (byte)0xA4, (byte)0x40,
        (byte)0xF2, (byte)0x77, (byte)0x03, (byte)0x7D, (byte)0x81, (byte)0x2D, (byte)0xEB, (byte)0x33,
        (byte)0xA0, (byte)0xF4, (byte)0xA1, (byte)0x39, (byte)0x45, (byte)0xD8, (byte)0x98, (byte)0xC2,
        (byte)0x96, (byte)0x4F, (byte)0xE3, (byte)0x42, (byte)0xE2, (byte)0xFE, (byte)0x1A, (byte)0x7F,
        (byte)0x9B, (byte)0x8E, (byte)0xE7, (byte)0xEB, (byte)0x4A, (byte)0x7C, (byte)0x0F, (byte)0x9E,
        (byte)0x16, (byte)0x2B, (byte)0xCE, (byte)0x33, (byte)0x57, (byte)0x6B, (byte)0x31, (byte)0x5E,
        (byte)0xCE, (byte)0xCB, (byte)0xB6, (byte)0x40, (byte)0x68, (byte)0x37, (byte)0xBF, (byte)0x51,
        (byte)0xF5
    };
    private static final byte[] P256_N = {
        (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0x00, (byte)0x00, (byte)0x00, (byte)0x00,
        (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF, (byte)0xFF,
        (byte)0xBC, (byte)0xE6, (byte)0xFA, (byte)0xAD, (byte)0xA7, (byte)0x17, (byte)0x9E, (byte)0x84,
        (byte)0xF3, (byte)0xB9, (byte)0xCA, (byte)0xC2, (byte)0xFC, (byte)0x63, (byte)0x25, (byte)0x51
    };

    private CardVaultApplet() {
        pin = new OwnerPIN(PIN_TRIES, PIN_MAX_LEN);
        byte[] defaultPin = { '1', '2', '3', '4' };
        pin.update(defaultPin, (short) 0, (byte) defaultPin.length);

        // Default limit: 1 SOL = 1_000_000_000 lamports = 0x3B9ACA00
        limit = new byte[] { (byte) 0x00, (byte) 0xCA, (byte) 0x9A, (byte) 0x3B, 0, 0, 0, 0 };

        scratch = JCSystem.makeTransientByteArray(MSG_LEN, JCSystem.CLEAR_ON_DESELECT);

        ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(
                KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
        ECPrivateKey priv = (ECPrivateKey) KeyBuilder.buildKey(
                KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
        setP256(pub);
        setP256(priv);
        keyPair = new KeyPair(pub, priv);
        keyPair.genKeyPair();

        signer = Signature.getInstance(Signature.ALG_ECDSA_SHA_256, false);
        signer.init(priv, Signature.MODE_SIGN);
    }

    private static void setP256(ECKey key) {
        key.setFieldFP(P256_P, (short) 0, (short) P256_P.length);
        key.setA(P256_A, (short) 0, (short) P256_A.length);
        key.setB(P256_B, (short) 0, (short) P256_B.length);
        key.setG(P256_G, (short) 0, (short) P256_G.length);
        key.setR(P256_N, (short) 0, (short) P256_N.length);
        key.setK((short) 1);
    }

    public static void install(byte[] bArray, short bOffset, byte bLength) {
        CardVaultApplet applet = new CardVaultApplet();
        if (bLength > 0 && bArray[bOffset] > 0) {
            // Standard GlobalPlatform install data: [AID length][instance AID]...
            applet.register(bArray, (short) (bOffset + 1), bArray[bOffset]);
        } else {
            applet.register(); // e.g. jCardSim with no install data
        }
    }

    public void deselect() {
        pin.reset();
    }

    public void process(APDU apdu) {
        if (selectingApplet()) {
            return;
        }
        byte[] buf = apdu.getBuffer();
        if (buf[ISO7816.OFFSET_CLA] != CLA) {
            ISOException.throwIt(ISO7816.SW_CLA_NOT_SUPPORTED);
        }
        switch (buf[ISO7816.OFFSET_INS]) {
            case INS_GET_PUBKEY: getPubkey(apdu); break;
            case INS_VERIFY_PIN: verifyPin(apdu); break;
            case INS_SIGN:       sign(apdu); break;
            case INS_SET_LIMIT:  setLimit(apdu); break;
            case INS_CHANGE_PIN: changePin(apdu); break;
            case INS_GET_INFO:   getInfo(apdu); break;
            default: ISOException.throwIt(ISO7816.SW_INS_NOT_SUPPORTED);
        }
    }

    /** Returns the uncompressed public key W (65 bytes: 04 || X || Y). */
    private void getPubkey(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        short len = ((ECPublicKey) keyPair.getPublic()).getW(buf, (short) 0);
        apdu.setOutgoingAndSend((short) 0, len);
    }

    private void verifyPin(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        short len = apdu.setIncomingAndReceive();
        if (pin.getTriesRemaining() == 0) {
            ISOException.throwIt(SW_PIN_BLOCKED);
        }
        if (!pin.check(buf, ISO7816.OFFSET_CDATA, (byte) len)) {
            byte left = pin.getTriesRemaining();
            ISOException.throwIt(left == 0 ? SW_PIN_BLOCKED : (short) (0x63C0 | left));
        }
    }

    private void requirePin() {
        if (!pin.isValidated()) {
            ISOException.throwIt(SW_PIN_REQUIRED);
        }
    }

    private void sign(APDU apdu) {
        requirePin();
        byte[] buf = apdu.getBuffer();
        short len = apdu.setIncomingAndReceive();
        if (len != MSG_LEN) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }
        Util.arrayCopyNonAtomic(buf, ISO7816.OFFSET_CDATA, scratch, (short) 0, MSG_LEN);

        byte tag = scratch[OFF_TAG];
        if (tag == TAG_WITHDRAW) {
            // The card itself checks the amount: malware cannot make it
            // sign a withdrawal above the limit.
            if (compareU64LE(scratch, OFF_AMOUNT, limit, (short) 0) > 0) {
                ISOException.throwIt(SW_LIMIT_EXCEEDED);
            }
        } else if (tag == TAG_RECOVER) {
            if (!isZero(scratch, OFF_AMOUNT, (short) 8)) {
                ISOException.throwIt(ISO7816.SW_WRONG_DATA);
            }
        } else {
            ISOException.throwIt(SW_BAD_TAG);
        }

        short sigLen = signer.sign(scratch, (short) 0, MSG_LEN, buf, (short) 0);
        pin.reset(); // PIN is required again for every signature
        apdu.setOutgoingAndSend((short) 0, sigLen);
    }

    private void setLimit(APDU apdu) {
        requirePin();
        byte[] buf = apdu.getBuffer();
        short len = apdu.setIncomingAndReceive();
        if (len != 8) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }
        Util.arrayCopy(buf, ISO7816.OFFSET_CDATA, limit, (short) 0, (short) 8);
    }

    private void changePin(APDU apdu) {
        requirePin();
        byte[] buf = apdu.getBuffer();
        short len = apdu.setIncomingAndReceive();
        if (len < PIN_MIN_LEN || len > PIN_MAX_LEN) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }
        pin.update(buf, ISO7816.OFFSET_CDATA, (byte) len);
        pin.reset();
    }

    /** Returns limit (8 bytes LE) || PIN tries remaining (1 byte). */
    private void getInfo(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        Util.arrayCopyNonAtomic(limit, (short) 0, buf, (short) 0, (short) 8);
        buf[8] = pin.getTriesRemaining();
        apdu.setOutgoingAndSend((short) 0, (short) 9);
    }

    /** Unsigned compare of two u64 little-endian values: -1, 0 or 1. */
    private static byte compareU64LE(byte[] a, short aOff, byte[] b, short bOff) {
        for (short i = 7; i >= 0; i--) {
            short x = (short) (a[(short) (aOff + i)] & 0xFF);
            short y = (short) (b[(short) (bOff + i)] & 0xFF);
            if (x > y) return 1;
            if (x < y) return -1;
        }
        return 0;
    }

    private static boolean isZero(byte[] a, short off, short len) {
        for (short i = 0; i < len; i++) {
            if (a[(short) (off + i)] != 0) return false;
        }
        return true;
    }
}
