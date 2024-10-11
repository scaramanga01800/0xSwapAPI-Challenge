// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Interface for ERC20 tokens
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract TokenSwap {
    address public owner;

    // Event to log token swaps
    event TokensSwapped(address indexed from, address indexed tokenA, address indexed tokenB, uint256 amountA, uint256 amountB);

    constructor() {
        owner = msg.sender; // Set the contract creator as the owner
    }

    function swapTokens(address tokenA, address tokenB, uint256 amountA) public returns (bool) {
        // Transfer tokenA from the sender to this contract
        require(IERC20(tokenA).transferFrom(msg.sender, address(this), amountA), "Transfer failed");

        // Here you would typically interact with the 0x API or a DEX to determine the amount of tokenB to send.
        // For simplicity, we will just send back an equivalent amount of tokenB based on a fixed ratio.
        uint256 amountB = amountA; // This is a placeholder. In reality, you would calculate this based on the exchange rate.

        // Transfer tokenB to the sender
        require(IERC20(tokenB).transfer(msg.sender, amountB), "Transfer failed");

        emit TokensSwapped(msg.sender, tokenA, tokenB, amountA, amountB);
        return true;
    }
}