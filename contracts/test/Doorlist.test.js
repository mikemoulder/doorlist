const { expect } = require('chai');
const { ethers } = require('hardhat');

// Runs on Hardhat's local EVM. Logic only: Revive deposits and gas are measured separately.
describe('Doorlist', () => {
  const PRICE = ethers.parseEther('2');
  let dl, organizer, alice, bob, door, aliceKey, bobKey;

  beforeEach(async () => {
    [organizer, alice, bob, door] = await ethers.getSigners();
    aliceKey = ethers.Wallet.createRandom();
    bobKey = ethers.Wallet.createRandom();
    dl = await (await ethers.getContractFactory('Doorlist')).deploy();
    await dl.connect(organizer).createEvent('Demo Day', 1794000000, 2, PRICE, ethers.ZeroAddress);
    await dl.connect(organizer).setDoor(0, door.address, true);
  });

  it('sells a ticket at face price and pays the organizer', async () => {
    await expect(dl.connect(alice).buy(0, aliceKey.address, { value: PRICE }))
      .to.changeEtherBalances([alice, organizer], [-PRICE, PRICE]);
    const t = await dl.tickets(0);
    expect(t.owner).to.equal(alice.address);
    expect(t.key).to.equal(aliceKey.address);
  });

  it('rejects wrong payment and enforces capacity', async () => {
    await expect(dl.connect(alice).buy(0, aliceKey.address, { value: 1n })).to.be.revertedWithCustomError(dl, 'WrongPayment');
    await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
    await dl.connect(bob).buy(0, bobKey.address, { value: PRICE });
    await expect(dl.connect(bob).buy(0, bobKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'SoldOut');
  });

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

  it('caps resale at face value, pays the seller and kills the old key', async () => {
    await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
    await expect(dl.connect(alice).list(0, PRICE + 1n)).to.be.revertedWithCustomError(dl, 'AboveFacePrice');
    await dl.connect(alice).list(0, PRICE);
    await expect(dl.connect(bob).buyResale(0, bobKey.address, { value: PRICE }))
      .to.changeEtherBalances([bob, alice], [-PRICE, PRICE]);
    const t = await dl.tickets(0);
    expect(t.owner).to.equal(bob.address);
    expect(t.key).to.equal(bobKey.address);
    await expect(dl.connect(bob).buyResale(0, bobKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'NotListed');
  });

  it('a used ticket cannot be listed or resold', async () => {
    await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
    await dl.connect(alice).list(0, PRICE);
    await dl.connect(door).checkIn(0);
    await expect(dl.connect(bob).buyResale(0, bobKey.address, { value: PRICE })).to.be.revertedWithCustomError(dl, 'NotListed');
    await expect(dl.connect(alice).list(0, PRICE)).to.be.revertedWithCustomError(dl, 'AlreadyUsed');
  });

  it('the QR signature check the door app runs: fresh key signature passes, old key fails', async () => {
    await dl.connect(alice).buy(0, aliceKey.address, { value: PRICE });
    const ts = Math.floor(Date.now() / 1000);
    const msg = `doorlist:0:${ts}`;
    const good = await aliceKey.signMessage(msg);
    expect(ethers.verifyMessage(msg, good)).to.equal((await dl.tickets(0)).key);
    await dl.connect(alice).rotateKey(0, bobKey.address); // e.g. new phone
    expect(ethers.verifyMessage(msg, good)).to.not.equal((await dl.tickets(0)).key);
  });

  describe('paid in a native-asset stablecoin (ERC-20 precompile path)', () => {
    const USD = 25_000_000n; // 25.00 with 6 decimals
    let usd;
    beforeEach(async () => {
      usd = await (await ethers.getContractFactory('MockStable')).deploy();
      await dl.connect(organizer).createEvent('Stable Night', 1794000000, 5, USD, await usd.getAddress());
      await dl.connect(organizer).setDoor(1, door.address, true);
      for (const s of [alice, bob]) {
        await usd.mint(s.address, 100_000_000n);
        await usd.connect(s).approve(await dl.getAddress(), ethers.MaxUint256);
      }
    });

    it('pulls the stablecoin from buyer to organizer, never holding it', async () => {
      await dl.connect(alice).buy(1, aliceKey.address);
      expect(await usd.balanceOf(organizer.address)).to.equal(USD);
      expect(await usd.balanceOf(await dl.getAddress())).to.equal(0n);
    });

    it('refuses native tPOT sent to a stablecoin event', async () => {
      await expect(dl.connect(alice).buy(1, aliceKey.address, { value: 1n })).to.be.revertedWithCustomError(dl, 'WrongPayment');
    });

    it('resale pays the seller in the stablecoin, capped at face value', async () => {
      await dl.connect(alice).buy(1, aliceKey.address);
      // first ticket in this block, so ticketId 0 (on event 1)
      await expect(dl.connect(alice).list(0, USD + 1n)).to.be.revertedWithCustomError(dl, 'AboveFacePrice');
      await dl.connect(alice).list(0, USD);
      await dl.connect(bob).buyResale(0, bobKey.address);
      expect(await usd.balanceOf(alice.address)).to.equal(100_000_000n);
      expect((await dl.tickets(0)).owner).to.equal(bob.address);
    });
  });
});
