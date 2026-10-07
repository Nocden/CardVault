"""Records a captioned walkthrough of the CardVault web app for the Colosseum demo video.

Usage: python3 record.py <W1 pubkey> <W2 pubkey> <out dir>
Needs the local stack (validator, two simulated cards, bridge) running on :8787.
"""
import sys
from playwright.sync_api import sync_playwright

W1, W2, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
URL = "http://localhost:8787/"

CAPTION_JS = """
([text, step]) => {
  let el = document.getElementById('__cap');
  if (!el) {
    el = document.createElement('div');
    el.id = '__cap';
    el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:1120px;width:max-content;' +
      'background:rgba(18,26,47,0.94);color:#EEF1F5;font:500 23px/1.35 system-ui,Segoe UI,sans-serif;padding:14px 22px;' +
      'border-radius:12px;z-index:99999;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;gap:14px;align-items:baseline';
    document.body.appendChild(el);
  }
  el.innerHTML = (step ? '<span style="color:#FF7A3D;font-weight:800">' + step + '</span>' : '') + '<span>' + text + '</span>';
  el.style.display = text ? 'flex' : 'none';
}
"""

CARD_JS = """
([title, sub]) => {
  let el = document.getElementById('__card');
  if (!title) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = '__card';
    el.style.cssText = 'position:fixed;inset:0;background:#121A2F;color:#EEF1F5;z-index:100000;display:flex;flex-direction:column;' +
      'justify-content:center;padding:0 110px;gap:22px;font-family:system-ui,Segoe UI,sans-serif';
    document.body.appendChild(el);
  }
  el.innerHTML = '<div style="font:800 64px/1.1 system-ui,sans-serif;letter-spacing:-1px">' + title + '</div>' +
    '<div style="font:400 28px/1.45 system-ui,sans-serif;color:#B7C1D4;max-width:980px">' + sub + '</div>';
}
"""

HIGHLIGHT_JS = """
(sel) => {
  const el = document.querySelector(sel);
  if (!el) return;
  el.scrollIntoView({behavior: 'smooth', block: 'center'});
  el.style.transition = 'box-shadow .2s';
  el.style.boxShadow = '0 0 0 4px #FF7A3D';
  setTimeout(() => { el.style.boxShadow = ''; }, 1400);
}
"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 720}, device_scale_factor=2,
            record_video_dir=OUT, record_video_size={"width": 1280, "height": 720},
        )
        pg = ctx.new_page()
        n = {"log": 0}

        def cap(text, step=""):
            pg.evaluate(CAPTION_JS, [text, step])

        def card(title, sub=""):
            pg.evaluate(CARD_JS, [title, sub])

        def hl(sel, wait=900):
            pg.evaluate(HIGHLIGHT_JS, sel)
            pg.wait_for_timeout(wait)

        def scroll_to(sel, wait=700):
            pg.evaluate("s => document.querySelector(s).scrollIntoView({behavior:'smooth', block:'start'})", sel)
            pg.wait_for_timeout(wait)

        def wait_log(pattern):
            n["log"] += 1
            pg.wait_for_function(
                "([p, n]) => { const l = document.querySelectorAll('#log li:not(.empty)');"
                " return l.length >= n && new RegExp(p).test(l[0].innerText); }",
                arg=[pattern, n["log"]], timeout=60000)

        def show_log(wait=3200):
            pg.evaluate("document.querySelector('#log li').scrollIntoView({behavior:'smooth', block:'center'})")
            pg.wait_for_timeout(wait)

        def pin(code="1234"):
            pg.wait_for_selector("#pinDialog[open]")
            pg.wait_for_timeout(700)
            pg.type("#pinInput", code, delay=180)
            pg.wait_for_timeout(400)
            pg.click("#pinOk")

        pg.goto(URL)
        pg.wait_for_timeout(1200)

        card("CardVault", "A physical second factor for Solana wallets.<br><br>"
             "This recording runs the real web app and Solana program on a local Solana validator, "
             "with two simulated cards running our Java Card applet.")
        pg.wait_for_timeout(6500)
        card("")

        cap("Connect the wallet. A test wallet here; in a normal browser it's Phantom.", "1")
        pg.wait_for_timeout(1800)
        hl("#devSelect", 600)
        pg.select_option("#devSelect", W1)
        pg.wait_for_selector("#createSection:not([hidden])")
        pg.wait_for_timeout(2500)

        cap("Read the recovery card, then create the vault. Both private keys were generated inside the cards.", "2")
        pg.wait_for_timeout(1500)
        hl("#readRecovery")
        pg.click("#readRecovery")
        pg.wait_for_function("document.getElementById('recoveryKey').value.length === 66")
        pg.wait_for_timeout(1800)
        hl("#createBtn")
        pg.click("#createBtn")
        wait_log("Vault created")
        pg.wait_for_timeout(1000)
        pg.click("#readCard")
        pg.wait_for_timeout(2500)

        cap("Add 3 SOL to the vault.", "3")
        scroll_to("#depositSection")
        pg.fill("#depositAmount", "3")
        hl("#depositForm button")
        pg.click("#depositForm button")
        wait_log("Added 3 SOL")
        pg.evaluate("window.scrollTo({top:0, behavior:'smooth'})")
        pg.wait_for_timeout(2500)

        cap("Send 0.2 SOL. The wallet signs the transaction; the card signs the amount and recipient after the PIN.", "4")
        scroll_to("#sendSection")
        pg.fill("#sendTo", W2)
        pg.fill("#sendAmount", "0.2")
        pg.wait_for_timeout(900)
        hl("#sendForm button")
        pg.click("#sendForm button")
        pin()
        wait_log("Sent 0.2 SOL")
        show_log()

        cap("Now malware has stolen the wallet key. Attack: withdraw without the card.", "5")
        scroll_to("#attackSection", 1500)
        hl("[data-attack='no-card']")
        pg.click("[data-attack='no-card']")
        wait_log("Blocked")
        show_log()

        cap("Attack: you approve 0.01 SOL on the card, the malware sends a transaction for 0.5 SOL.", "6")
        scroll_to("#attackSection", 1500)
        hl("[data-attack='swap-amount']")
        pg.click("[data-attack='swap-amount']")
        pin()
        wait_log("Blocked")
        show_log()

        cap("Attack: the malware swaps the recipient after you approve on the card.", "7")
        scroll_to("#attackSection", 1500)
        hl("[data-attack='swap-recipient']")
        pg.click("[data-attack='swap-recipient']")
        pin()
        wait_log("Blocked")
        show_log()

        cap("Send 2 SOL: above the card's 1 SOL limit. The chip itself refuses to sign.", "8")
        scroll_to("#sendSection", 1200)
        pg.fill("#sendAmount", "2")
        pg.wait_for_timeout(700)
        hl("#sendForm button")
        pg.click("#sendForm button")
        pin()
        wait_log("Card refused")
        show_log()

        cap("Wallet key stolen? Open a new wallet and use the recovery card. No seed phrase.", "9")
        pg.evaluate("window.scrollTo({top:0, behavior:'smooth'})")
        pg.wait_for_timeout(1500)
        hl("#devSelect", 600)
        pg.select_option("#devSelect", W2)
        pg.wait_for_selector("#recoverSection:not([hidden])")
        scroll_to("#recoverSection", 1500)
        hl("#recoverForm button")
        pg.click("#roleRecovery")
        pg.click("#recoverForm button")
        pin()
        wait_log("Vault moved")
        pg.evaluate("window.scrollTo({top:0, behavior:'smooth'})")
        pg.wait_for_timeout(3500)

        cap("The vault now belongs to the new wallet. The stolen key can't move anything.", "10")
        pg.click("#readCard")
        pg.wait_for_timeout(3500)
        show_log(3000)

        # Sharp 2x screenshot of the activity log for the pitch deck.
        cap("")
        pg.locator("#log").screenshot(path=OUT + "/activity-log@2x.png")

        card("A stolen key should be worth zero.", "CardVault: your wallet + a card. Funds move only when both sign.")
        pg.wait_for_timeout(5000)

        video = pg.video
        ctx.close()
        print("VIDEO", video.path())
        browser.close()


if __name__ == "__main__":
    main()
