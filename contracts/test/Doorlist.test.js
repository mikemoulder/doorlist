const { expect } = require('chai');
const { ethers } = require('hardhat');

// Runs on Hardhat's local EVM. Logic only: Revive deposits and gas are measured separately.
describe('Doorlist', () => {
  const PRICE = ethers.parseEther('2');
  const DAY = 24 * 60 * 60;
  const fee = (x) => (x * 300n) / 10_000n;
  let dl, organizer, alice, bob, carol, door, treasury, aliceKey, bobKey, startsAt;

  const now = async () => (await ethers.provider.getBlock('latest')).timestamp;
  const warpTo = async (ts) => {
    await ethers.provider.send('evm_setNextBlockTimestamp', [ts]);
    await ethers.provider.send('evm_mine', []);
  };

  // createEvent(name, startsAt, capacity, price, currency, maxPerWallet, royaltyBps)
  const create = (opts = {}) =>
    dl.connect(organizer).createEvent(
      opts.name ?? 'Demo Day', opts.startsAt ?? startsAt, opts.capacity ?? 10, opts.price ?? PRICE,
      opts.currency ?? ethers.ZeroAddress, opts.maxPerWallet ?? 0, opts.royaltyBps ?? 500,
    );

  beforeEach(async () => {
    [organizer, alice, bob, carol, door, treasury] = await ethers.getSigners();
    aliceKey = ethers.Wallet.createRandom();
    bobKey = ethers.Wallet.createRandom();
    dl = await (await ethers.getContractFactory('Doorlist')).deploy(treasury.address);
    startsAt = (await now()) + 7 * DAY;
    await create();
    await dl.connect(organizer).setDoor(0, door.address, true);
  });

  describe('primary sale into escrow', () => {
    it('holds the full price in the contract; nobody is paid yet', async () => {
      await expect(dl.connect(alice).buy(0, aliceKey.address, { value: PRICE }))
        .to.changeEtherBalances([alice, dl, organizer, treasury], [-PRICE, PRICE, 0n, 0n]);
      expect((await dl.events(0)).escrowed).to.equal(PRICE);
      const t = await dl.tickets(0);
      expect(t.owner).to.equal(alice.address);
      expect(t.key).to.equal(aliceKey.address);
    });

    it('rejects wrong payment and enforces capacity', async () => {
      await create({ capacity: 1 }); // event 1
      await expect(dl.connect(alice).buy(1, aliceKey.address, { value: 1n })).to.be.revertedWithCustomError(dl, 'WrongPayment');
      await dl.connect(alice).buy(1, aliceKey.address, { value: PRICE });
      await expect(dl.connect(bob).buy(1, bobKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'SoldOut');
    });

    it('rejects a royalty above 10%', async () => {
      await expect(create({ royaltyBps: 1001 })).to.be.revertedWithCustomError(dl, 'RoyaltyTooHigh');
    });
  });

  describe('organizer payout', () => {
    it('opens 24h after the start: 97% to the organizer, 3% to the treasury, even for no-shows', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      await dl.connect(bob).buy(0, bobKey.address, { value: PRICE }); // bob never shows up
      await dl.connect(door).checkIn(0);
      await expect(dl.connect(organizer).withdraw(0)).to.be.revertedWithCustomError(dl, 'TooEarly');
      await warpTo(startsAt + DAY);
      const total = PRICE * 2n;
      await expect(dl.connect(alice).withdraw(0)).to.be.revertedWithCustomError(dl, 'NotOrganizer');
      await expect(dl.connect(organizer).withdraw(0))
        .to.changeEtherBalances([dl, organizer, treasury], [-total, total - fee(total), fee(total)]);
      expect((await dl.events(0)).escrowed).to.equal(0n);
    });

    it('can withdraw again for sales made after the first payout', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      await warpTo(startsAt + DAY);
      await dl.connect(organizer).withdraw(0);
      await dl.connect(bob).buy(0, bobKey.address, { value: PRICE });
      await expect(dl.connect(organizer).withdraw(0)).to.changeEtherBalance(organizer, PRICE - fee(PRICE));
    });
  });

  describe('cancel and refund (no organizer needed)', () => {
    it('only the organizer can cancel; a cancelled event blocks sales, resales, check-ins and payout', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE }); // ticket 0
      await dl.connect(alice).list(0, PRICE);
      await expect(dl.connect(alice).cancelEvent(0)).to.be.revertedWithCustomError(dl, 'NotOrganizer');
      await expect(dl.connect(organizer).cancelEvent(0)).to.emit(dl, 'EventCancelled');
      await expect(dl.connect(bob).buy(0, bobKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'Cancelled');
      await expect(dl.connect(bob).buyResale(0, bobKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'Cancelled');
      await expect(dl.connect(door).checkIn(0)).to.be.revertedWithCustomError(dl, 'Cancelled');
      await warpTo(startsAt + DAY);
      await expect(dl.connect(organizer).withdraw(0)).to.be.revertedWithCustomError(dl, 'Cancelled');
    });

    it('each holder claims 100% back from escrow, once; the treasury takes nothing', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      await expect(dl.connect(alice).claimRefund(0)).to.be.revertedWithCustomError(dl, 'NotCancelled');
      await dl.connect(organizer).cancelEvent(0);
      await expect(dl.connect(bob).claimRefund(0)).to.be.revertedWithCustomError(dl, 'NotOwner');
      await expect(dl.connect(alice).claimRefund(0))
        .to.changeEtherBalances([dl, alice, organizer, treasury], [-PRICE, PRICE, 0n, 0n]);
      await expect(dl.connect(alice).claimRefund(0)).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
      await expect(dl.connect(alice).list(0, PRICE)).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
    });

    it('a ticket already scanned before a mid-event cancel is still refundable', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      await dl.connect(door).checkIn(0);
      await dl.connect(organizer).cancelEvent(0);
      await expect(dl.connect(alice).claimRefund(0)).to.changeEtherBalance(alice, PRICE);
    });

    it('a resale buyer gets the face price back (the reseller already has their price)', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      await dl.connect(alice).list(0, PRICE * 3n);
      await dl.connect(bob).buyResale(0, bobKey.address, { value: PRICE * 3n });
      await dl.connect(organizer).cancelEvent(0);
      await expect(dl.connect(alice).claimRefund(0)).to.be.revertedWithCustomError(dl, 'NotOwner');
      await expect(dl.connect(bob).claimRefund(0)).to.changeEtherBalance(bob, PRICE);
    });

    it('cannot cancel once the payout window is open', async () => {
      await warpTo(startsAt + DAY);
      await expect(dl.connect(organizer).cancelEvent(0)).to.be.revertedWithCustomError(dl, 'TooLate');
    });
  });

  describe('per-wallet limit', () => {
    beforeEach(async () => {
      await create({ maxPerWallet: 1 }); // event 1
    });

    it('stops one wallet buying more than the organizer allows', async () => {
      await dl.connect(alice).buy(1, aliceKey.address, { value: PRICE });
      await expect(dl.connect(alice).buy(1, aliceKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'WalletLimit');
      expect(await dl.held(1, alice.address)).to.equal(1n);
    });

    it('applies to resale buyers too, and frees the seller', async () => {
      await dl.connect(alice).buy(1, aliceKey.address, { value: PRICE }); // ticket 0
      await dl.connect(bob).buy(1, bobKey.address, { value: PRICE }); // ticket 1
      await dl.connect(alice).list(0, PRICE);
      await expect(dl.connect(bob).buyResale(0, bobKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'WalletLimit');
      await dl.connect(carol).buyResale(0, bobKey.address, { value: PRICE });
      expect(await dl.held(1, alice.address)).to.equal(0n);
      await dl.connect(alice).buy(1, aliceKey.address, { value: PRICE }); // alice may buy again
    });

    it('0 means no limit', async () => {
      for (let i = 0; i < 3; i++) await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      expect(await dl.held(0, alice.address)).to.equal(3n);
    });
  });

  describe('door', () => {
    it('checks in once and refuses the second scan', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      await expect(dl.connect(door).checkIn(0)).to.emit(dl, 'CheckedIn');
      await expect(dl.connect(door).checkIn(0)).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
    });

    it('only an authorized door can check in', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      await expect(dl.connect(bob).checkIn(0)).to.be.revertedWithCustomError(dl, 'NotDoor');
      await expect(dl.connect(alice).setDoor(0, alice.address, true)).to.be.revertedWithCustomError(dl, 'NotOrganizer');
    });

    it('the QR signature check the door app runs: fresh key signature passes, old key fails', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      const msg = `doorlist:0:${await now()}`;
      const sig = await aliceKey.signMessage(msg);
      expect(ethers.verifyMessage(msg, sig)).to.equal((await dl.tickets(0)).key);
      await dl.connect(alice).rotateKey(0, bobKey.address); // e.g. new phone
      expect(ethers.verifyMessage(msg, sig)).to.not.equal((await dl.tickets(0)).key);
    });
  });

  describe('resale (peer to peer)', () => {
    it('lists at any price; pays 3% treasury, 5% organizer royalty, 92% seller instantly; kills the old key', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      const ask = PRICE * 5n; // well above face value: allowed
      await dl.connect(alice).list(0, ask);
      const royalty = (ask * 500n) / 10_000n;
      await expect(dl.connect(bob).buyResale(0, bobKey.address, { value: ask }))
        .to.changeEtherBalances([bob, alice, organizer, treasury, dl], [-ask, ask - fee(ask) - royalty, royalty, fee(ask), 0n]);
      const t = await dl.tickets(0);
      expect(t.owner).to.equal(bob.address);
      expect(t.key).to.equal(bobKey.address);
      await expect(dl.connect(carol).buyResale(0, bobKey.address, { value: ask })).to.be.revertedWithCustomError(dl, 'NotListed');
    });

    it('price 0 delists; only the owner can list', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      await expect(dl.connect(bob).list(0, PRICE)).to.be.revertedWithCustomError(dl, 'NotOwner');
      await dl.connect(alice).list(0, PRICE);
      await dl.connect(alice).list(0, 0);
      await expect(dl.connect(bob).buyResale(0, bobKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'NotListed');
    });

    it('a used ticket cannot be listed or resold', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      await dl.connect(alice).list(0, PRICE);
      await dl.connect(door).checkIn(0);
      await expect(dl.connect(bob).buyResale(0, bobKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'NotListed');
      await expect(dl.connect(alice).list(0, PRICE)).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
    });
  });

  // The stablecoin path (ERC-20 precompile) is tested against the real Portaldot
  // native-asset precompile on the testnet after deploy.
});
