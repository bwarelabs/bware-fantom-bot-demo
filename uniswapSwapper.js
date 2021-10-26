const Web3 = require('web3');
const ethers = require('ethers');
const {ChainId, Fetcher, Token, WETH, Route, Trade, TokenAmount, TradeType} = require("@ac32/spookyswap-sdk");
const BigNumber = require('bignumber.js');
const tools = require('./utils/tools');
const {logger} = require('./utils/logger');


let web3_provider = undefined;
let ethers_provider = undefined;

module.exports = {
    init: async function (Scenario) {
        this.cfg = Scenario;
        web3_provider = new Web3(new Web3.providers.WebsocketProvider(this.cfg.endpoint));
        ethers_provider = new ethers.providers.WebSocketProvider(this.cfg.endpoint,);

        this.chainID = await web3_provider.eth.getChainId();
        logger.info(`Trading on the Fantom Opera of network chain ID ${this.chainID}`);
    },

    start_Bot: async function () {
        this.stopSwapper = false;
        web3_provider.eth.accounts.wallet.add(this.cfg.PK);
        this.accountAddress = web3_provider.eth.accounts.privateKeyToAccount(this.cfg.PK)['address'];

        if (!web3_provider.utils.isAddress(this.cfg.tokenAddress)) {
            logger.error(`The provided token address ${this.cfg.tokenAddress} is not valid`);
            process.exit(1);
        }

        this.routerV2contract = new web3_provider.eth.Contract(tools.routerV2ABI, this.cfg.routerV2Address);
        await this.routerV2contract.methods.WETH().call().then((wethAddress) => {
            this.wethAddress = wethAddress.toString();
        });
        this.WETHContract = new web3_provider.eth.Contract(tools.tokenABI, this.wethAddress);
        this.tokenContract = new web3_provider.eth.Contract(tools.tokenABI, this.cfg.tokenAddress);
        this.botContract = new web3_provider.eth.Contract(tools.contractBotABI, this.cfg.botAddress);

        await this.botContract.methods.isSwapper(this.accountAddress).call().then(async (success) => {
            if (!success) {
                logger.error(`Current wallet ${this.accountAddress} is not a swapper of the bot contract`);
                process.exit(1);
            }
        });

        await web3_provider.eth.getBalance(this.cfg.botAddress).then((wei_balance) => {
            this.cfg.etherToSell = parseFloat(new BigNumber(web3_provider.utils.fromWei(wei_balance, 'ether')).toFixed(6));
        });
        await this.listen_liquidity();
    },

    listen_liquidity: async function () {
        logger.info(`Listening on liquidity on token ${this.cfg.tokenAddress} to trade ${this.cfg.etherToSell} FTM using swapper ${this.accountAddress}`);
        const routerAddress = this.cfg.routerV2Address.toLowerCase();
        const signatureHash = '0xf305d719'; // of the method addLiquidityETH

        this.etherDecimals = await this.WETHContract.methods.decimals().call().then((decimals) => {
            return parseInt(decimals.toString());
        });
        this.tokenDecimals = await this.tokenContract.methods.decimals().call().then((decimals) => {
            return parseInt(decimals.toString());
        });

        web3_provider.eth.subscribe('pendingTransactions', function (error, result) {
            if (error) {
                logger.error(error);
            }
        }).on("data", async (tx_hash) => {
            let tx = null;
            try {
                tx = await web3_provider.eth.getTransaction(tx_hash);
            } catch (error) {
                logger.error(error);
            }

            if (tx && tx.to && (tx.to.toLowerCase() === routerAddress)) {
                if (tx.input.startsWith(signatureHash)) {
                    let decoded = web3_provider.eth.abi.decodeParameters(
                        ['address', 'uint256', 'uint256', 'uint256', 'address', 'uint256'],
                        tx.input.substring(10));

                    if (decoded[0].toLowerCase() === this.cfg.tokenAddress.toLowerCase()) {
                        logger.info(`Found add-liquidity transaction referencing token ${this.cfg.tokenAddress} with hash ${tx_hash}`);
                        if (tx.gasPrice) {
                            this.gasPrice = tx.gasPrice;
                            logger.info(`Would buy tokens worth of ${this.cfg.etherToSell} FTM using gas price of ${Web3.utils.fromWei(this.gasPrice, 'gwei')} gwei for the buy transaction:`);
                            logger.info(`Buying tokens using the FTM supply...`);
                            await this.buyTokens();
                        }
                    }
                }
            }
        });
    },

    buyTokens: async function () {
        await this.botContract.methods.buy().send({
            from: this.accountAddress,
            gasPrice: this.gasPrice,
            gas: this.cfg.gasLimitDefault
        }).on('transactionHash', async function (buy_tx_hash) {
            logger.info(`The buy transaction has been broadcast and has tx hash: ${buy_tx_hash}`);
        }).on('receipt', async (receipt) => {
            this.tokensToSell = new BigNumber(receipt.events.TokensAmount['raw']['data']);
            logger.info(`The buy transaction has been mined on block ${receipt.blockNumber} and bought ${this.tokensToSell.toFixed()} tokens`);
            await this.waitOnPrice();
        }).on('error', async (error) => {
            logger.warn(`The buy transaction has failed with error ${error}`);
            logger.warn(`Retry the buy transaction on next valid addLiquidity if there is one...`);
        });
    },

    waitOnPrice: async function () {
        logger.info(`Start searching for optimal block to sell the tokens...`);
        let seenBlocks = new Set(); // solve the problem of headers subscription firing twice for same block
        let token = new Token(this.chainID, this.cfg.tokenAddress, this.tokenDecimals);
        let lowerBound = (this.cfg.targetLoss / 100) * this.cfg.etherToSell;
        let upperBound = (this.cfg.targetProfit / 100) * this.cfg.etherToSell;

        await this.checkBounds(token, lowerBound, upperBound).then(async () => {
            web3_provider.eth.subscribe('newBlockHeaders', async (error, result) => {
                if (!error && !seenBlocks.has(result.number) && this.cfg.blockRetryCount > 0 && !this.stopSwapper) {
                    seenBlocks.add(result.number);
                    this.cfg.blockRetryCount -= 1; // decrease the retry counter
                    logger.info(`Block ${result.number} has just been mined`);
                    await this.checkBounds(token, lowerBound, upperBound);
                }
            });
        });
    },

    checkBounds: async function (token, lowerBound, upperBound) {
        await Fetcher.fetchPairData(token, WETH[this.chainID], ethers_provider).then(async (pair) => {
            let route = new Route([pair], token);
            let trade = new Trade(route, new TokenAmount(token, this.tokensToSell.toFixed()), TradeType.EXACT_INPUT);
            let ethIfSell = parseFloat(new BigNumber(trade.executionPrice.toSignificant(6)).multipliedBy(this.tokensToSell).shiftedBy(-1 * this.etherDecimals).toFixed(6));
            logger.info(`Current price movement ${lowerBound} / ${ethIfSell} / ${upperBound}`);

            if (ethIfSell <= lowerBound || ethIfSell >= upperBound || this.cfg.blockRetryCount <= 0) {
                await this.sellTokens();
            }
        });
    },


    sellTokens: async function () {
        try {
            this.fastGasPrice = await web3_provider.eth.getGasPrice().then((gasPrice) => {
                return new BigNumber(gasPrice).multipliedBy(this.cfg.gasPriceIncrease).toFixed(0);
            });
            logger.info(`Use the web3 computed gas price for the sell transaction: ${Web3.utils.fromWei(this.fastGasPrice, 'gwei')} gwei`);
        } catch (error) {
            process.exit();
        }
        await this.botContract.methods.sell().send({
            from: this.accountAddress,
            gasPrice: this.fastGasPrice,
            gas: this.cfg.gasLimitDefault
        }).on('transactionHash', async function (tx_hash) {
            logger.info(`The sell transaction has been broadcast to the blockchain with hash: ${tx_hash}`);
        }).on('error', async (error) => {
            logger.error(error);
            logger.error(`The sell transaction failed, need to transfer tokens back to owner`);
            this.stopSwapper = true;

            this.fastGasPrice = new BigNumber(this.fastGasPrice).plus(new BigNumber(1).shiftedBy(9)); // don't trigger replacement tx underpriced
            await this.botContract.methods.withdrawToken().send({
                from: this.accountAddress,
                gasPrice: this.fastGasPrice,
                gas: this.cfg.gasLimitDefault
            }).on('receipt', async (receipt) => {
                logger.warn(`The TRANSFER BACK tokens transaction has been successful`);
                process.exit(0);
            }).on('error', async (error) => {
                logger.error(`TRANSFER TOKENS failed, use Remix/TrustWallet instead`);
                process.exit(2);
            });

        }).on('receipt', async (receipt) => {
            logger.info(`The sell transaction has been successful`);
            this.stopSwapper = true; // basically stop the subscription to new blocks
            const ethBought = new BigNumber(receipt.events.EtherAmount.returnValues.amount).shiftedBy(-1 * this.etherDecimals).toFixed(6);
            logger.info(`Successfully sold all tokens for ${ethBought} FTM`);
            process.exit(0);
        });
    },
}