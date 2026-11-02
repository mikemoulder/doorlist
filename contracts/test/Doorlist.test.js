const { expect } = require('chai');
const { ethers } = require('hardhat');

// Runs the real contract on Hardhat's local EVM. Revive deposits and gas are measured
// separately against the live testnet. The stablecoin path (native-asset ERC-20 precompile)
// is tested on the live testnet after deploy.
describe('Doorlist', () => {
  const PRICE = ethers.parseEther('2');
  const DAY = 24 * 60 * 60;
  const ZERO = ethers.ZeroAddress;
  const fee = (x) => (x * 300n) / 10_000n;
  let dl, organizer, alice, bob, carol, door, treasury, startsAt;

  const now = async () => (await ethers.provider.getBlock('latest')).timestamp;
  const warpTo = async (ts) => {
    await ethers.provider.send('evm_setNextBlockTimestamp', [ts]);
    await ethers.provider.send('evm_mine', []);
  };

  // createEvent(name, startsAt, capacity, price, currency, maxPerWallet, royaltyBps)
  const create = (opts = {}) =>
    dl.connect(organizer).createEvent(
      opts.name ?? 'Demo Day', opts.startsAt ?? startsAt, opts.capacity ?? 10, opts.price ?? PRICE,
      ZERO, opts.maxPerWallet ?? 0, opts.royaltyBps ?? 500,
    );

  beforeEach(async () => {
    [organizer, alice, bob, carol, door, treasury] = await ethers.getSigners();
    dl = await (await ethers.getContractFactory('Doorlist')).deploy(treasury.address);
    startsAt = (await now()) + 7 * DAY;
    await create();
    await dl.connect(organizer).setDoor(0, door.address, true);
  });

  describe('primary sale into escrow', () => {
    it('mints a wallet-owned ticket and holds the full price in the contract', async () => {
      const tx = dl.connect(alice).buy(0, { value: PRICE });
      await expect(tx).to.emit(dl, 'Transfer').withArgs(ZERO, alice.address, 0n);
      await expect(tx).to.changeEtherBalances([alice, dl, organizer, treasury], [-PRICE, PRICE, 0n, 0n]);
      expect(await dl.ownerOf(0)).to.equal(alice.address);
      expect((await dl.events(0)).escrowed).to.equal(PRICE);
    });

    it('rejects wrong payment and enforces capacity', async () => {
      await create({ capacity: 1 }); // event 1
      await expect(dl.connect(alice).buy(1, { value: 1n })).to.be.revertedWithCustomError(dl, 'WrongPayment');
      await dl.connect(alice).buy(1, { value: PRICE });
      await expect(dl.connect(bob).buy(1, { value: PRICE })).to.be.revertedWithCustomError(dl, 'SoldOut');
    });

    it('rejects a royalty above 10%', async () => {
      await expect(create({ royaltyBps: 1001 })).to.be.revertedWithCustomError(dl, 'RoyaltyTooHigh');
    });
  });

  describe('organizer payout', () => {
    it('opens 24h after the start: 97% to the organizer, 3% to the treasury, even for no-shows', async () => {
      await dl.connect(alice).buy(0, { value: PRICE });
      await dl.connect(bob).buy(0, { value: PRICE }); // bob never shows up
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
      await dl.connect(alice).buy(0, { value: PRICE });
      await warpTo(startsAt + DAY);
      await dl.connect(organizer).withdraw(0);
      await dl.connect(bob).buy(0, { value: PRICE });
      await expect(dl.connect(organizer).withdraw(0)).to.changeEtherBalance(organizer, PRICE - fee(PRICE));
    });
  });

  describe('cancel and refund (no organizer needed)', () => {
    it('only the organizer can cancel; a cancelled event blocks sales, resales, gifts, check-ins and payout', async () => {
      await dl.connect(alice).buy(0, { value: PRICE }); // ticket 0
      await dl.connect(alice).list(0, PRICE);
      await expect(dl.connect(alice).cancelEvent(0)).to.be.revertedWithCustomError(dl, 'NotOrganizer');
      await expect(dl.connect(organizer).cancelEvent(0)).to.emit(dl, 'EventCancelled');
      await expect(dl.connect(bob).buy(0, { value: PRICE })).to.be.revertedWithCustomError(dl, 'Cancelled');
      await expect(dl.connect(bob).buyResale(0, { value: PRICE })).to.be.revertedWithCustomError(dl, 'Cancelled');
      await expect(dl.connect(alice).transfer(0, bob.address)).to.be.revertedWithCustomError(dl, 'Cancelled');
      await expect(dl.connect(door).checkIn(0)).to.be.revertedWithCustomError(dl, 'Cancelled');
      await warpTo(startsAt + DAY);
      await expect(dl.connect(organizer).withdraw(0)).to.be.revertedWithCustomError(dl, 'Cancelled');
    });

    it('each holder claims 100% back from escrow, once; the treasury takes nothing', async () => {
      await dl.connect(alice).buy(0, { value: PRICE });
      await expect(dl.connect(alice).claimRefund(0)).to.be.revertedWithCustomError(dl, 'NotCancelled');
      await dl.connect(organizer).cancelEvent(0);
      await expect(dl.connect(bob).claimRefund(0)).to.be.revertedWithCustomError(dl, 'NotOwner');
      await expect(dl.connect(alice).claimRefund(0))
        .to.changeEtherBalances([dl, alice, organizer, treasury], [-PRICE, PRICE, 0n, 0n]);
      await expect(dl.connect(alice).claimRefund(0)).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
    });

    it('a ticket already scanned before a mid-event cancel is still refundable', async () => {
      await dl.connect(alice).buy(0, { value: PRICE });
      await dl.connect(door).checkIn(0);
      await dl.connect(organizer).cancelEvent(0);
      await expect(dl.connect(alice).claimRefund(0)).to.changeEtherBalance(alice, PRICE);
    });

    it('after a resale, the new token gets the face price back; the burned one gets nothing', async () => {
      await dl.connect(alice).buy(0, { value: PRICE }); // ticket 0
      await dl.connect(alice).list(0, PRICE * 3n);
      await dl.connect(bob).buyResale(0, { value: PRICE * 3n }); // ticket 1
      await dl.connect(organizer).cancelEvent(0);
      await expect(dl.connect(alice).claimRefund(0)).to.be.revertedWithCustomError(dl, 'NotOwner');
      await expect(dl.connect(bob).claimRefund(1)).to.changeEtherBalance(bob, PRICE);
      expect((await dl.events(0)).escrowed).to.equal(0n);
    });

    it('cannot cancel once the payout window is open', async () => {
      await warpTo(startsAt + DAY);
      await expect(dl.connect(organizer).cancelEvent(0)).to.be.revertedWithCustomError(dl, 'TooLate');
    });
  });

  describe('resale and gifts: burn and re-mint', () => {
    it('resale at any price burns the old token, mints a new one, and splits 3% / 5% / 92% instantly', async () => {
      await dl.connect(alice).buy(0, { value: PRICE }); // ticket 0
      const ask = PRICE * 5n; // well above face value: allowed
      await dl.connect(alice).list(0, ask);
      const royalty = (ask * 500n) / 10_000n;
      const tx = dl.connect(bob).buyResale(0, { value: ask });
      await expect(tx).to.emit(dl, 'Transfer').withArgs(alice.address, ZERO, 0n);
      await expect(tx).to.emit(dl, 'Transfer').withArgs(ZERO, bob.address, 1n);
      await expect(tx).to.emit(dl, 'Reminted').withArgs(0n, 1n, ask);
      await expect(tx).to.changeEtherBalances([bob, alice, organizer, treasury, dl], [-ask, ask - fee(ask) - royalty, royalty, fee(ask), 0n]);
      expect(await dl.ownerOf(0)).to.equal(ZERO);
      expect(await dl.ownerOf(1)).to.equal(bob.address);
      expect(await dl.held(0, alice.address)).to.equal(0n);
      expect(await dl.held(0, bob.address)).to.equal(1n);
      await expect(dl.connect(carol).buyResale(0, { value: ask })).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
    });

    it('a gift is free: burned and re-minted to the friend, nobody is paid', async () => {
      await dl.connect(alice).buy(0, { value: PRICE }); // ticket 0
      await expect(dl.connect(bob).transfer(0, carol.address)).to.be.revertedWithCustomError(dl, 'NotOwner');
      const tx = dl.connect(alice).transfer(0, bob.address);
      await expect(tx).to.emit(dl, 'Reminted').withArgs(0n, 1n, 0n);
      await expect(tx).to.changeEtherBalances([organizer, treasury, dl], [0n, 0n, 0n]);
      expect(await dl.ownerOf(1)).to.equal(bob.address);
      await expect(dl.connect(door).checkIn(0)).to.be.revertedWithCustomError(dl, 'AlreadyUsed'); // old id is dead
      await dl.connect(door).checkIn(1);
    });

    it('price 0 delists; only the owner can list', async () => {
      await dl.connect(alice).buy(0, { value: PRICE });
      await expect(dl.connect(bob).list(0, PRICE)).to.be.revertedWithCustomError(dl, 'NotOwner');
      await dl.connect(alice).list(0, PRICE);
      await dl.connect(alice).list(0, 0);
      await expect(dl.connect(bob).buyResale(0, { value: PRICE })).to.be.revertedWithCustomError(dl, 'NotListed');
    });

    it('a used ticket cannot be listed, resold or gifted', async () => {
      await dl.connect(alice).buy(0, { value: PRICE });
      await dl.connect(alice).list(0, PRICE);
      await dl.connect(door).checkIn(0);
      await expect(dl.connect(bob).buyResale(0, { value: PRICE })).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
      await expect(dl.connect(alice).list(0, PRICE)).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
      await expect(dl.connect(alice).transfer(0, bob.address)).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
    });
  });

  describe('per-wallet limit', () => {
    beforeEach(async () => {
      await create({ maxPerWallet: 1 }); // event 1
    });

    it('stops one wallet buying more than the organizer allows', async () => {
      await dl.connect(alice).buy(1, { value: PRICE });
      await expect(dl.connect(alice).buy(1, { value: PRICE })).to.be.revertedWithCustomError(dl, 'WalletLimit');
    });

    it('applies to resale buyers and gift receivers, and frees the seller', async () => {
      await dl.connect(alice).buy(1, { value: PRICE }); // ticket 0
      await dl.connect(bob).buy(1, { value: PRICE }); // ticket 1
      await dl.connect(alice).list(0, PRICE);
      await expect(dl.connect(bob).buyResale(0, { value: PRICE })).to.be.revertedWithCustomError(dl, 'WalletLimit');
      await expect(dl.connect(alice).transfer(0, bob.address)).to.be.revertedWithCustomError(dl, 'WalletLimit');
      await dl.connect(carol).buyResale(0, { value: PRICE }); // ticket 2
      expect(await dl.held(1, alice.address)).to.equal(0n);
      await dl.connect(alice).buy(1, { value: PRICE }); // alice may buy again
    });

    it('0 means no limit', async () => {
      for (let i = 0; i < 3; i++) await dl.connect(alice).buy(0, { value: PRICE });
      expect(await dl.held(0, alice.address)).to.equal(3n);
    });
  });

  describe('door', () => {
    it('checks in once and refuses the second scan', async () => {
      await dl.connect(alice).buy(0, { value: PRICE });
      await expect(dl.connect(door).checkIn(0)).to.emit(dl, 'CheckedIn');
      await expect(dl.connect(door).checkIn(0)).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
    });

    it('only an authorized door can check in; a revoked door cannot', async () => {
      await dl.connect(alice).buy(0, { value: PRICE });
      await expect(dl.connect(bob).checkIn(0)).to.be.revertedWithCustomError(dl, 'NotDoor');
      await expect(dl.connect(alice).setDoor(0, alice.address, true)).to.be.revertedWithCustomError(dl, 'NotOrganizer');
      await dl.connect(organizer).setDoor(0, door.address, false);
      await expect(dl.connect(door).checkIn(0)).to.be.revertedWithCustomError(dl, 'NotDoor');
    });

    it('the QR check the door app runs: wallet-signed device pass + fresh device signature', async () => {
      await dl.connect(alice).buy(0, { value: PRICE }); // ticket 0
      const device = ethers.Wallet.createRandom(); // lives on the phone showing the ticket
      // once per phone: the owner's wallet authorizes this device for ticket 0
      const pass = `doorlist pass: ticket 0 device ${device.address}`;
      const passSig = await alice.signMessage(pass);
      // every few seconds: the device signs the ticket and the time
      const qr = `doorlist:0:${await now()}`;
      const qrSig = await device.signMessage(qr);
      // door side
      expect(ethers.verifyMessage(pass, passSig)).to.equal(await dl.ownerOf(0));
      expect(ethers.verifyMessage(qr, qrSig)).to.equal(device.address);
      // after a gift, the same pass no longer matches: ticket 0 is burned
      await dl.connect(alice).transfer(0, bob.address);
      expect(ethers.verifyMessage(pass, passSig)).to.not.equal(await dl.ownerOf(0));
    });
  });
});
