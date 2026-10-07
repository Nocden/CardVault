# CardVault: Demo Day and submission kit

Everything here is paste-ready. Fill in the `[brackets]` before you submit or present.

## Today's checklist

| | what | where | note |
|---|---|---|---|
| ☐ | Colosseum project: details, media & code, team | Colosseum | final submission is open; deadline Oct 12, 23:59 PDT (Oct 13, 08:59 Prague). Submit today, edit later |
| ☐ | Every team member fills in their own Submission Profile | Colosseum | the owner can't do it for them |
| ☐ | Same project on the SolanaCZE track | Superteam Earn | separate submission, link the Colosseum page |
| ☐ | Opt in to the **Accretion security track** | Demo Day Document | not automatic; this project is a security project |
| ☐ | Register the Demo Day pitch slot | Google sheet from the handbook | project, team, tracks, slot |
| ☐ | GitHub repo pushed; judges have access | GitHub | can be private if judges get access |
| ☐ | Demo video (max 3 min) and pitch video (max 2 min) | YouTube / Loom / Vimeo | links go into Colosseum; can be replaced later |
| ☐ | Rehearse the 3-minute pitch with a timer, 3 times | | one speaker, English, no live demo |

Also eligible: Best Student Team, Best Demo Day Pitch.

---

## Demo Day pitch (3 minutes, one speaker, no live demo)

About 400 words: 2:50 at a calm pace. The same text is in the speaker notes of each slide.
If you run long in rehearsal, cut the sentences marked *(cut if long)*.

**Slide 1: Hook (0:00-0:25)**
Say the first sentence before you look at the slide. No "hello", no name first.

> By the time I finish this pitch, someone, somewhere, will have lost their crypto. Not to a market crash. To a thief.
>
> *(pause)*
>
> Last year there were one hundred fifty-eight thousand personal wallet thefts. One every three minutes and twenty seconds. That's exactly how long I have on this stage.
>
> I'm [name], and this is CardVault.

**Slide 2: Problem (0:25-0:55)**

> Here's why it keeps happening. Fifteen million people use Phantom every month. Their keys live in a browser extension or a phone app, right next to phishing links and malware.
>
> One stolen key, and everything is gone. No bank to call, no undo. Seven hundred million dollars, last year alone.
>
> Hardware wallets help, but they mean a new wallet, a new gadget and usually a seed phrase to guard.

**Slide 3: Product (0:55-1:30)** (hold up your real card at "this card")

> CardVault adds a physical card to the wallet you already use.
>
> Your money sits in a vault on Solana, and it moves only when two things sign: your normal wallet, and this card, with a tap and a PIN. A thief with your stolen key gets exactly zero.
>
> The chip also enforces its own spending limit, so even a hacked laptop can't push a big payment through.
>
> And if you lose your key, a second card moves the vault to a new wallet. No seed phrase.

**Slide 4: Proof and why now (1:30-2:00)**

> This isn't a mockup. We built it this week: the software on the card, the Solana program and the app.
>
> Then we attacked our own vault: stolen keys, changed amounts, swapped recipients, replayed signatures. Every attack was rejected on-chain.
>
> And the timing is right: since 2025, Solana natively verifies the signatures chip cards already make.

**Slide 5: Business (2:00-2:35)**

> And we're not building another wallet. Tangem replaces your wallet. Passkey wallets keep the key on the same phone you're trying to protect. We plug into the wallets people already use, as their physical second factor.
>
> We earn three ways: card kits sold through wallet partners, an SDK licence for smart-wallet providers, and card sets for teams and treasuries.
>
> Just one percent of Phantom's monthly users would be a hundred and fifty thousand card kits. *(cut if long)*

**Slide 6: Close (2:35-3:00)**

> Next: a phone app over NFC, a security audit, and a pilot with a Solana wallet.
>
> We're [names], [one line about who you are].
>
> We're looking for a wallet partner to pilot with, and investors who believe self-custody needs a physical key.
>
> Because a stolen key should be worth zero. Thank you.

Stop after "Thank you". Smile, wait for questions.

**Delivery tips**
- Learn the first two sentences and the last sentence by heart. Everything in between can be read from notes if needed.
- Bring the physical card on stage. Holding it up on slide 3 is your "demo".
- Say numbers slowly: "one hundred fifty-eight thousand", "three minutes and twenty seconds".
- Pause after "To a thief." and after "worth zero."

---

## Judge questions (2 minutes): short answers

**"Why would a wallet integrate you?"**
Theft is their users' biggest fear and their support team's worst ticket. We give them a premium security tier without building hardware. Solana smart wallets already verify P-256 signatures for passkeys, so a card is one more signer type for them, not a rewrite.

**"Who pays, and how much?"**
The user buys a card kit once; the wallet partner pays a licence per active vault or shares kit revenue. Blank smart cards are commodity hardware, so we target a kit price below Tangem's 3-card pack ($69). [Fill in the real cost of your cards from your supplier.] Pricing is a hypothesis we want to test in the pilot.

**"Isn't this just Tangem?"**
Tangem is a wallet: it replaces yours and signs everything itself. We are a second factor plus rules on-chain: limits, recovery to a new wallet, and the program checks exactly what the card approved. You keep Phantom; the card makes a stolen Phantom key useless.

**"What about passkey wallets like LazorKit?"**
Passkeys live on your phone and sync through your cloud account, the same place an attacker goes after. Our key is generated inside a separate chip and never leaves it. We see them as partners: our card could be a signer type inside their wallets.

**"What if someone steals the card?"**
They need the PIN: five wrong tries and the card blocks itself. And they still need your wallet key. Lose the card, and the recovery card moves the vault.

**"The card has no screen. Malware can make you approve the wrong thing."**
True, it's the same for every screenless card. Damage is capped: the chip enforces its own limit, and on-chain we verify the transaction is exactly what the card signed. Next step: show the details on the phone over NFC before you tap.

**"Is it audited?"**
Not yet. It's a hackathon prototype with an attack test suite. An audit is the first thing on our six-month plan.

**"Why you?"**
We built the full stack in days: software running on the smart card, the Solana program and the app. [Add backgrounds: e.g. electrical/embedded experience, 42 Prague, security interest.] One of us lost access to his own wallets; we're our first users.

**"Go-to-market?"**
Start with crypto-native power users and small teams that hold a treasury, through one wallet partner. Then card sets for teams.

**"Are you raising?"**
[Decide before you go on stage. Simple answer: "Not today. We're looking for a pilot partner and want to talk to investors about a pre-seed after the pilot."]

---

## Colosseum: project details

**Project name:** CardVault

**Brief description:**
A physical second factor for Solana wallets. Funds sit in an on-chain vault and move only when your wallet and a smart card both sign, so a stolen wallet key is worth zero. A second card replaces the seed phrase.

**Website:** [GitHub or live link]

**What are you building and who is it for?**
CardVault turns an ordinary chip card (contact + NFC) into a hardware second factor for the wallet people already use. Money sits in a Solana vault. A withdrawal needs the owner's wallet signature plus the card's signature, made only after a PIN and only if the amount is within a limit the chip enforces itself. If the wallet key is lost or stolen, a recovery card moves the vault to a new wallet; there is no seed phrase.
It's for the millions of people who keep real money in browser and mobile wallets (Phantom alone reported 15M monthly users in January 2025), and for small teams that hold a treasury. We don't build another wallet: we plan to sell card kits through wallet partners and license the signer to Solana smart-wallet providers.

**Why are you building it and why now?**
Personal wallets are the target: Chainalysis counted 158,000 personal wallet compromises in 2025, about $713M stolen. Hot-wallet keys sit on the same device where phishing and malware land, and one stolen key means total, final loss. Hardware wallets help but mean a new wallet, a new gadget and usually a seed phrase.
Since 2025, Solana verifies secp256r1 (P-256) signatures natively (SIMD-0075). That is exactly the signature standard smart cards already produce, so an inexpensive chip card can now be a first-class Solana signer. One of our teammates had his own access and security problems with MetaMask and Phantom; that's where the idea came from.

**Technologies / tools:** Java Card 3.0.4 (NXP JCOP J3H081 cards), GlobalPlatformPro, jCardSim, Rust + Anchor 0.31, Solana secp256r1 precompile, TypeScript, @solana/web3.js, PC/SC, Phantom. AI tools: [list what you used].

**Chains:** Solana

**How we use Solana:**
An Anchor program holds SOL in a PDA vault. Every withdrawal transaction has two instructions: the native secp256r1 precompile verifies the card's P-256 signature over an 81-byte message (vault, recipient, amount, nonce), and our program checks that the precompile verified this vault's card and exactly this withdrawal, then checks the owner's signature and the nonce. Recovery works the same way with the recovery card's key, rotating the vault's owner.

**Category:** [Security / Infrastructure / Consumer]
**Team location:** Prague, Czechia
**Telegram:** [@handle]

**Notes for judges:**
Working prototype built at the Prague Build Station: Java Card applet, Anchor program, local bridge and web app. The repo includes a card simulator, so everything runs without hardware: `./scripts/web-local.sh` (web app) or `./scripts/demo-local.sh` (CLI + attack tests). Tested on a local Solana validator: normal payments, the card refusing over-limit payments, recovery to a new wallet, and attacks rejected on-chain (stolen key without card, changed amount, swapped recipient, replayed signature, signature from another card). Not audited.

## Colosseum: media & code

- **Logo:** [upload; a simple card-with-chip mark works]
- **GitHub:** [link]; give judges access if private
- **Demo video (max 3 min):** [link]; see "Demo video" below
- **Live product:** none public yet (runs locally, see notes for judges)
- **Pitch video (max 2 min):** [link]; script below

## Superteam Earn (SolanaCZE track)

- **Project name + short description:** CardVault: a physical second factor for Solana wallets. A stolen wallet key is worth zero without the card.
- **Team members:** [names, roles, Telegram]
- **Product / demo link:** [demo video link]
- **GitHub:** [link]
- **Short demo video:** [link]
- **Problem:** 158,000 personal wallet compromises in 2025 (Chainalysis), about $713M stolen. Hot-wallet keys live next to the malware, and one stolen key is final, total loss. Hardware wallets mean switching wallets and guarding a seed phrase.
- **Solution:** keep your wallet, add a card. Funds move only when wallet and card both sign; the chip enforces a spending limit; a recovery card replaces the seed phrase.
- **How Solana is used:** Anchor vault program + native secp256r1 precompile verifying the card's P-256 signatures; program checks card key, exact amount and recipient, nonce and owner.
- **What we built during the hackathon:** Java Card applet, Anchor program, TypeScript CLI, local card bridge and web app, card simulator setup, on-chain attack test suite.
- **Users / testers / validation:** [Talk to 5 people today and fill in, e.g. "We asked 12 Build Station participants: 9 keep funds in a browser wallet, 7 said they'd pay for a card kit." Use only real numbers.]
- **Business model:** card kits through wallet partners, SDK licence per active vault for smart-wallet providers, card sets for teams and treasuries. No revenue yet.
- **Colosseum link:** [link]

---

## Pitch video (max 2 minutes, separate from the demo)

Phone camera, quiet room, faces visible. About 250 words.

> Hi, we're [names], and we're building CardVault.
>
> [Name] works on [card software / Solana program], [name] on [app / product]. We're [one line: e.g. students at 42 Prague; background in electrical engineering / security].
>
> The problem: last year, 158,000 personal crypto wallets were compromised. Wallet keys live in browser extensions and phone apps, right next to the malware. One stolen key and everything is gone.
>
> One of us went through this with MetaMask and Phantom. [Say it only if true; one sentence about what happened.]
>
> So we built a physical second factor. Your money sits in a Solana vault and moves only when your wallet and a smart card both sign, with a PIN. The chip enforces its own spending limit. A second card replaces the seed phrase. And we attacked our own vault: every attack was rejected on-chain.
>
> Why us: we built the whole stack this week, from the software running on the chip to the Solana program and the app. And we're our own first users.
>
> What's next: a phone app over NFC, a security audit and a pilot with a Solana wallet. We'll keep building after the hackathon.
>
> Thanks for watching.

## Demo video (max 3 minutes, show the live product)

`docs/cardvault-demo.mp4` in the repo (1:35) is a captioned screen recording of the web app (local Solana validator, simulated cards). Upload it to YouTube (unlisted) or Loom. If you have time, record a version with your real card on the reader; the captions in the recording show the order of scenes.
