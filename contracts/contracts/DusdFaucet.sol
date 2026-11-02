// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Gives each address one batch of test dUSD so anyone with tPOT for gas can try
/// Doorlist. dUSD is a native pallet_assets token; `token` is its ERC-20 precompile.
/// The pool is filled by minting to this contract with the asset's issuer key.
contract DusdFaucet {
    IERC20Transfer public immutable token;
    uint256 public immutable amount;
    mapping(address => bool) public claimed;

    event Claimed(address indexed to, uint256 amount);

    error AlreadyClaimed();
    error PoolEmpty();

    constructor(IERC20Transfer token_, uint256 amount_) {
        token = token_;
        amount = amount_;
    }

    function claim() external {
        if (claimed[msg.sender]) revert AlreadyClaimed();
        claimed[msg.sender] = true;
        if (!token.transfer(msg.sender, amount)) revert PoolEmpty();
        emit Claimed(msg.sender, amount);
    }
}
