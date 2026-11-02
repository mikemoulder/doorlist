const { expect } = require('chai');
const { ethers } = require('hardhat');

// Runs on Hardhat's local EVM. Logic only: Revive deposits and gas are measured separately.
describe('Doorlist', () => {
  const PRICE = ethers.parseEther('2');
  const fee = (x) => (x * 300n) / 10_000n;
  let dl, organizer, alice, bob, carol, door, treasury, aliceKey, bobKey;

  // createEvent(name, startsAt, capacity, price, currency, maxPerWallet, royaltyBps)
  const create = (opts = {}) =>
    dl.connect(organizer).createEvent(
      opts.name ?? 'Demo Day', 1794000000, opts.capacity ?? 10, opts.price ?? PRICE,
      opts.currency ?? ethers.ZeroAddress, opts.maxPerWallet ?? 0, opts.royaltyBps ?? 500,
    );

  beforeEach(async () => {
    [organizer, alice, bob, carol, door, treasury] = await ethers.getSigners();
    aliceKey = ethers.Wallet.createRandom();
    bobKey = ethers.Wallet.createRandom();
    dl = await (await ethers.getContractFactory('Doorlist')).deploy(treasury.address);
    await create();
    await dl.connect(organizer).setDoor(0, door.address, true);
  });

  describe('primary sale', () => {
    it('splits 3% to the treasury and 97% to the organizer', async () => {
      await expect(dl.connect(alice).buy(0, aliceKey.address, { value: PRICE }))
        .to.changeEtherBalances([alice, organizer, treasury, dl], [-PRICE, PRICE - fee(PRICE), fee(PRICE), 0n]);
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
      const msg = `doorlist:0:${Math.floor(Date.now() / 1000)}`;
      const sig = await aliceKey.signMessage(msg);
      expect(ethers.verifyMessage(msg, sig)).to.equal((await dl.tickets(0)).key);
      await dl.connect(alice).rotateKey(0, bobKey.address); // e.g. new phone
      expect(ethers.verifyMessage(msg, sig)).to.not.equal((await dl.tickets(0)).key);
    });
  });

  describe('resale', () => {
    it('lists at any price; pays 3% treasury, 5% organizer royalty, 92% seller; kills the old key', async () => {
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

  describe('cancel and refund', () => {
    it('only the organizer can cancel; a cancelled event blocks sales, resales and check-ins', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE }); // ticket 0
      await dl.connect(alice).list(0, PRICE);
      await expect(dl.connect(alice).cancelEvent(0)).to.be.revertedWithCustomError(dl, 'NotOrganizer');
      await expect(dl.connect(organizer).cancelEvent(0)).to.emit(dl, 'EventCancelled');
      expect((await dl.events(0)).cancelled).to.equal(true);
      await expect(dl.connect(bob).buy(0, bobKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'Cancelled');
      await expect(dl.connect(bob).buyResale(0, bobKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'Cancelled');
      await expect(dl.connect(door).checkIn(0)).to.be.revertedWithCustomError(dl, 'Cancelled');
    });

    it('organizer refunds the face price from their own wallet; the ticket is voided; the fee stays', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      await dl.connect(organizer).cancelEvent(0);
      await expect(dl.connect(alice).refund(0, { value: PRICE })).to.be.revertedWithCustomError(dl, 'NotOrganizer');
      await expect(dl.connect(organizer).refund(0, { value: 1n })).to.be.revertedWithCustomError(dl, 'WrongPayment');
      await expect(dl.connect(organizer).refund(0, { value: PRICE }))
        .to.changeEtherBalances([organizer, alice, treasury, dl], [-PRICE, PRICE, 0n, 0n]);
      expect((await dl.tickets(0)).used).to.equal(true);
      expect(await dl.held(0, alice.address)).to.equal(0n);
      await expect(dl.connect(organizer).refund(0, { value: PRICE })).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
      await expect(dl.connect(alice).list(0, PRICE)).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
    });

    it('a checked-in ticket cannot be refunded', async () => {
      await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
      await dl.connect(door).checkIn(0);
      await expect(dl.connect(organizer).refund(0, { value: PRICE })).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
    });
  });

  describe('paid in a native-asset stablecoin (ERC-20 precompile path)', () => {
    const USD = 25_000_000n; // 25.00 with 6 decimals
    const START = 100_000_000n;
    let usd;
    beforeEach(async () => {
      usd = await (await ethers.getContractFactory('MockStable')).deploy();
      await create({ name: 'Stable Night', price: USD, currency: await usd.getAddress() }); // event 1
      for (const s of [alice, bob]) {
        await usd.mint(s.address, START);
        await usd.connect(s).approve(await dl.getAddress(), ethers.MaxUint256);
      }
    });

    it('splits the stablecoin 3% treasury / 97% organizer and never holds it', async () => {
      await dl.connect(alice).buy(1, aliceKey.address);
      expect(await usd.balanceOf(treasury.address)).to.equal(fee(USD));
      expect(await usd.balanceOf(organizer.address)).to.equal(USD - fee(USD));
      expect(await usd.balanceOf(await dl.getAddress())).to.equal(0n);
    });

    it('refuses native tPOT sent to a stablecoin event', async () => {
      await expect(dl.connect(alice).buy(1, aliceKey.address, { value: 1n })).to.be.revertedWithCustomError(dl, 'WrongPayment');
    });

    it('resale splits the stablecoin across seller, organizer and treasury', async () => {
      await dl.connect(alice).buy(1, aliceKey.address); // ticket 0
      const ask = 40_000_000n;
      await dl.connect(alice).list(0, ask);
      await dl.connect(bob).buyResale(0, bobKey.address);
      const royalty = (ask * 500n) / 10_000n;
      expect(await usd.balanceOf(alice.address)).to.equal(START - USD + ask - fee(ask) - royalty);
      expect(await usd.balanceOf(organizer.address)).to.equal(USD - fee(USD) + royalty);
      expect(await usd.balanceOf(treasury.address)).to.equal(fee(USD) + fee(ask));
      expect((await dl.tickets(0)).owner).to.equal(bob.address);
    });

    it('refunds in the stablecoin, pulled from the organizer', async () => {
      await dl.connect(alice).buy(1, aliceKey.address); // ticket 0
      await usd.connect(organizer).approve(await dl.getAddress(), ethers.MaxUint256);
      await usd.mint(organizer.address, fee(USD)); // organizer received 97%, needs 100% to refund
      await dl.connect(organizer).refund(0);
      expect(await usd.balanceOf(alice.address)).to.equal(START);
      expect(await usd.balanceOf(organizer.address)).to.equal(0n);
    });
  });
});
