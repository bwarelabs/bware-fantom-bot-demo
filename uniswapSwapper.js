const {logger} = require('./utils/logger');
const tools = require('./utils/tools');
const Web3 = require('web3');
const ethers = require('ethers');
const {ChainId, Fetcher, Token, WETH, Route, Trade, TokenAmount, TradeType} = require('@uniswap/sdk');
const BigNumber = require('bignumber.js');
const axios = require("axios");


let ws_provider = undefined;
let http_provider = undefined;
let oracle_provider = undefined;

module.exports = {
    init: async function (Scenario) {
        this.cfg = Scenario;
        ws_provider = new Web3(new Web3.providers.WebsocketProvider(this.cfg.ethEndpoint));
        this.chainID = await ws_provider.eth.getChainId();
        logger.info(`We are on the Fantom Opera network of chain ID ${this.chainID}`);

    },

    start_Bot: async function () {
        this.stopSelling = false;
        ws_provider.eth.accounts.wallet.add(this.cfg.PK);
        this.walletAddress = ws_provider.eth.accounts.privateKeyToAccount(this.cfg.PK)['address'];

        if (!ws_provider.utils.isAddress(this.cfg.tokenAddress)) {
            logger.error(`The provided token address ${this.cfg.tokenAddress} is not valid, please check it is checksum`);
            process.exit(1);
        }

        this.routerV2contract = new ws_provider.eth.Contract(tools.routerV2ABI, this.cfg.routerV2Address);
        await this.routerV2contract.methods.WETH().call().then((wethAddress) => {
            this.wethAddress = wethAddress.toString();
        });
        this.WETHContract = new ws_provider.eth.Contract(tools.tokenABI, this.wethAddress);
        this.tokenContract = new ws_provider.eth.Contract(tools.tokenABI, this.cfg.tokenAddress);
        this.botContract = new ws_provider.eth.Contract(tools.contractBotABI, this.cfg.botContractAddress);

        await this.botContract.methods.getCurrentOwner().call().then(async (owner) => {
            if (owner.toString().toLowerCase() !== this.walletAddress.toLowerCase()) {
                logger.error(`Current wallet ${this.walletAddress} is not the owner of the bot contract: ${owner.toString()}`);
                process.exit(1);
            }
        });

        await ws_provider.eth.getBalance(this.walletAddress).then((wei_balance) => {
            this.ethBalance = parseFloat(new BigNumber(ws_provider.utils.fromWei(wei_balance, 'ether')).toFixed(6));
            if (this.cfg.etherToSell >= this.ethBalance) {
                logger.error(`Currently there is insufficient ETH to perform the trade ${this.ethBalance}/${this.cfg.etherToSell}`);
                process.exit(1);
            }
        });
        await this.listen_addLiquidity();
    },

    listen_addLiquidity: async function () {
        logger.info(`Start listening for valid addLiquidity on token ${this.cfg.tokenAddress} to sell ${this.cfg.etherToSell} from wallet ${this.walletAddress}`);
        const routerAddress = this.cfg.routerV2Address.toLowerCase();
        const signatureHash = '0xf305d719'; // of the method addLiquidityETH
        this.gasLeftLimit = 22000;

        this.etherDecimals = await this.WETHContract.methods.decimals().call().then((decimals) => {
            return parseInt(decimals.toString());
        });
        this.tokenDecimals = await this.tokenContract.methods.decimals().call().then((decimals) => {
            return parseInt(decimals.toString());
        });

        this.addLiquidityGasCheck = await ws_provider.eth.getGasPrice().then(async (gasPrice) => {
            return parseFloat(new BigNumber(gasPrice).shiftedBy(-9).toFixed(6));
        });

        logger.info(`Estimated gas price recommended for the liquidity tx in gwei is ${this.addLiquidityGasCheck}`);

        this.weiToSell = new BigNumber(this.cfg.etherToSell).shiftedBy(this.etherDecimals);
        this.subscription = ws_provider.eth.subscribe('pendingTransactions', function (error, result) {
            if (error) {
                logger.error(error);
            }
        }).on("data", async (tx_hash) => {
            let tx = null;
            try {
                tx = await ws_provider.eth.getTransaction(tx_hash);
            } catch (error) {
                logger.error(error);
            }

            if (tx && tx.to && (tx.to.toLowerCase() === routerAddress)) {
                if (tx.input.startsWith(signatureHash)) {
                    let decoded = ws_provider.eth.abi.decodeParameters(
                        ['address', 'uint256', 'uint256', 'uint256', 'address', 'uint256'],
                        tx.input.substring(10));

                    if (decoded[0].toLowerCase() === this.cfg.tokenAddress.toLowerCase()) {
                        logger.info(`Found addLiquidity transaction referencing token ${this.cfg.tokenAddress} with hash ${tx_hash}`);

                        try {
                            // convert both gas prices from wei to gwei
                            let observedGasPrice = parseFloat(new BigNumber(tx.gasPrice).shiftedBy(-9).toFixed(6));
                            this.invalidLiquidityGas = observedGasPrice < this.addLiquidityGasCheck * 0.8;
                        } catch (err) {
                            logger.warn(err); // we could not parse the gasPrice of liquidity tx (so better stop the buy here)
                            this.invalidLiquidityGas = true;
                        }

                        let ethLiquidity = parseFloat(new BigNumber(decoded[3]).shiftedBy(-1 * this.etherDecimals).toFixed(6));
                        logger.info(`The amount of ETH added in liquidity is ${ethLiquidity}`);
                        if (ethLiquidity < this.cfg.etherTargetLiquidity || this.invalidLiquidityGas) {
                            logger.error(`Insufficient ETH liquidity ${ethLiquidity}/${this.cfg.etherTargetLiquidity} or insufficient gas price of the liquidity tx`);
                        } else {
                            if (tx.gasPrice) {
                                this.gasPrice = tx.gasPrice;
                                logger.info(`Would buy tokens worth of ${this.cfg.etherToSell}, gasPrice used for the BUY transaction ${this.gasPrice}`);
                                logger.info(`Buying tokens with supplied ETH...`);
                                await this.swapExactETHForTokens(this.weiToSell);
                            }
                        }
                    }
                }
            }
        });
    },

    swapExactETHForTokens: async function (weiToSell) {
        await this.botContract.methods.swapBwareETH(this.cfg.tokenAddress, this.cfg.slippageBuy, this.gasLeftLimit).send({
            from: this.walletAddress,
            gasPrice: this.gasPrice,
            gas: this.cfg.gasLimitDefault,
            value: weiToSell
        }).on('transactionHash', async function (buy_tx_hash) {
            logger.info(`The buy transaction has been broadcast to the blockchain with hash: ${buy_tx_hash}`);
        }).on('receipt', async (receipt) => {
            this.tokensToSell = new BigNumber(receipt.events.TokensOut['raw']['data']);
            logger.info(`The buy transaction has been mined on block ${receipt.blockNumber} and bought ${this.tokensToSell.toFixed()} tokens`);
            await this.subscription.unsubscribe(async (error, success) => {
                if (success) {
                    logger.info(`Successfully unsubscribed from the pending tx poll`);
                }
            });
            await this.sellTokens();

        }).on('error', async (error) => {
            logger.warn(`The buy transaction has failed with error ${error}`);
            logger.warn(`Retry the buy transaction on next valid addLiquidity if there is one...`);
        });
    },

    sellTokens: async function () {
        logger.info(`Start searching for optimal block to sell the tokens...`);
        let seenBlocks = new Set(); // solve the problem of headers subscription firing twice for same block
        let token = new Token(this.chainID, this.cfg.tokenAddress, this.tokenDecimals);
        let lowerBound = (this.cfg.lossTrigger / 100) * this.cfg.etherToSell;
        let upperBound = (this.cfg.profitTarget / 100) * this.cfg.etherToSell;

        await this.checkProfitBound(token, lowerBound, upperBound).then(async () => {
            ws_provider.eth.subscribe('newBlockHeaders', async (error, result) => {
                if (!error && !seenBlocks.has(result.number) && this.cfg.blockRetryCount > 0 && !this.stopSelling) {
                    seenBlocks.add(result.number);
                    this.cfg.blockRetryCount -= 1; // decrease the retry counter
                    logger.info(`Block ${result.number} has just been mined`);
                    await this.checkProfitBound(token, lowerBound, upperBound);
                }
            });
        });
    },

    checkProfitBound: async function (token, lowerBound, upperBound) {
        await Fetcher.fetchPairData(token, WETH[this.chainID], oracle_provider).then(async (pair) => {
            let route = new Route([pair], token);
            let trade = new Trade(route, new TokenAmount(token, this.tokensToSell.toFixed()), TradeType.EXACT_INPUT);
            let ethIfSell = parseFloat(new BigNumber(trade.executionPrice.toSignificant(6)).multipliedBy(this.tokensToSell).shiftedBy(-1 * this.etherDecimals).toFixed(6));
            logger.info(`Current price movement ${lowerBound} / ${ethIfSell} / ${upperBound}`);

            if (ethIfSell <= lowerBound || ethIfSell >= upperBound || this.cfg.blockRetryCount <= 0) {
                await this.swapExactTokensForETH();
            }
        });
    },

    swapExactTokensForETH: async function (emergency = false) {
        try {
            const response = await axios.get('https://ethgasstation.info/json/ethgasAPI.json');
            this.fastGasPrice = new BigNumber(Math.ceil(parseFloat(response.data.fastest) *
                this.cfg.gasPriceIncrease / 10)).shiftedBy(9).toFixed(0);
            logger.info(`Fastest gasPrice for sell transaction is ${this.fastGasPrice} wei`);
        } catch (error) {
            logger.warn(error.response.body);
            this.fastGasPrice = await http_provider.eth.getGasPrice().then(async (gasPrice) => {
                return new BigNumber(gasPrice).multipliedBy(this.cfg.gasPriceIncrease).toFixed(0);
            });
            logger.info(`Will use the web3 recommended gasPrice for sell transaction ${this.fastGasPrice} wei`);
        }
        await this.emergencySellTokens();
    },

    emergencySellTokens: async function () {
        await this.botContract.methods.swapBwareTokens(5, 100, 0).send({
            from: this.walletAddress,
            gasPrice: this.fastGasPrice,
            gas: this.cfg.gasLimitDefault
        }).on('transactionHash', async function (tx_hash) {
            logger.info(`The SELL transaction has been broadcast to the blockchain with hash: ${tx_hash}`);

        }).on('error', async (error) => {
            logger.error(error);
            logger.error(`The SELL transaction failed, need to transfer tokens back to owner`);
            this.stopSelling = true;

            this.fastGasPrice = new BigNumber(this.fastGasPrice).plus(new BigNumber(1).shiftedBy(9)); // don't trigger replacement tx underpriced
            await this.botContract.methods.withdrawToken().send({
                from: this.walletAddress,
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
            logger.info(`The SELL transaction has been successful`);
            this.stopSelling = true; // basically stop the subscription to new blocks
            const ethBought = new BigNumber(receipt.events.TokensOut[1]['raw']['data']).shiftedBy(-1 * this.etherDecimals).toFixed();
            logger.info(`Successfully bought ${ethBought} ETH`);
            process.exit(0);
        });
    },
}