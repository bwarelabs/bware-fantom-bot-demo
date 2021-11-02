# Sniping trading bot for DEXes

[![N|Solid](https://raw.githubusercontent.com/bwarelabs/brand-assets/master/svg/logo/logo.svg)](https://raw.githubusercontent.com/bwarelabs/brand-assets/master/svg/logo/logo.svg)
[![Build Status](https://travis-ci.org/joemccann/dillinger.svg?branch=master)](https://travis-ci.org/joemccann/dillinger)

## ![alt text](/docs/BWARE-icon.png) Swapper smart contract
Firstly, in order to disable *slippage reverts* when buying or selling, you can use the swapper contract provided and deploy it on the blockchain hosting the decentralized exchange. This can be achieved by using the *Remix IDE* at https://remix.ethereum.org/

The deployer account will be the owner and will be grated config privileges

Additional swappers accounts, implicitly allowed to buy or sell assets on behalf of the contract, can be registered by the owner by calling the method:
```c
function addSwappers(address[] calldata accounts) external onlyOwner {
```
The supported pair type used for swap operations is (**ETH**,**\<TOKEN\>**) and it can be configurable using:
```c
function configToken(address token) external onlyOwner {
```
## ![alt text](/docs/BWARE-icon.png) Installation

In order to be able to run the listener for the liquidity injection transaction you should install *node* and *npm* locally. Useful instructions can be found at https://linuxconfig.org/install-npm-on-linux

The dependencies can be installed at once by executing:
```bash
 npm install package.json
 ```
The run command starting the listening process is:
```js
node uniswapBot.js --endpoint=<WS_ENDPOINT> --tokenAddress=<TOKEN_CONTRACT_ADDR> --botAddress=<SWAPPER_CONTRACT_ADDR>  --PK=<SWAPPER_ACCOUNT_PK>
```

## ![alt text](/docs/BWARE-icon.png) Configuration and setup 


- Find the official contract address of the token listing you want to buy at (try to avoid scams!)
- Config the the swapper contract with the token address 
- Send the amount of ETH you want to invest directly to the swapper contract, the buy transaction will use the entire balance for the swap trade
- Provide a different WebSocket endpoint for each bot instance in order to increase your chances
- Decide on the stop loss and profit target percentages and specify them as cli arguments:
```
--targetProfit=150 --targetLoss=75
```
- Start the instances before the token listing happens

## ![alt text](/docs/BWARE-icon.png) Contact

For official inquiries, you can contact us at <info@bwarelabs.com>.

For other details, feel free to contact us on **Discord** (_Alex | bwarelabs.com#0292).

## ![alt text](/docs/BWARE-icon.png) Copyright

Copyright © 2021 [BwareLabs](https://bwarelabs.com/)
- [Telegram](https://t.me/BwareLabsAnnouncements)
- [Twitter](https://twitter.com/BwareLabs)
- [Linkedin](https://www.linkedin.com/company/bwarelabs)

![alt text](/docs/BWARE_yellow_gradient.png)
