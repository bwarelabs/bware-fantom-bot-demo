const es = require('./uniswapSwapper');


let Scenario = new Object();
Scenario.ethEndpoint = 'wss://fantom-mainnet-api.bwarelabs.com/ws/b23b4fc2-f87e-4896-9823-f2b709047a4e';
Scenario.tokenAddress = '0x693a782a9e25bf9b8585fe05cf4f1fc559da9ccc'; // need to be in checksum form
Scenario.PK = '8e8cdfbb7de38aec26c55e771a2e7157899465a387642b64ff73eeefbb295b3e';
Scenario.etherTargetLiquidity = 0.001; //buy tokens only if the the ETH liquidity (in ether) is greater than this
Scenario.profitTarget = 200; //profit target in percents relative to the amount of ETH invested 200%
Scenario.lossTrigger = 75; //sell tokens if current price gives us back ETH less than this percent of the invested one

Scenario.slippageBuy = 10; //how much price variation will tolerate in buy trades in %
Scenario.slippageSell = 10; //how much price variation will tolerate in sell trades in %
Scenario.botContractAddress = '0x8E08E1c7Ea05E89cBDe9FDa97F2b563B176deD81'; // need to change contractBotABI in tools as well
Scenario.gasPriceIncrease = 2.0; //in percentage. Ex 1.2 will mean gas price is 120% fastest gas possible
Scenario.gasLimitDefault = 300000; //the default gas limit in computation units for a swap transaction
Scenario.blockRetryCount = 20; //how many blocks after the buy to examine (for target profit/loss) until forcefully selling
Scenario.routerV2Address = '0xF491e7B69E4244ad4002BC14e878a34207E38c29';

const args = require('minimist')(process.argv.slice(2), {string: ['tokenAddress'], float: ['etherToSell']});

function setUpScenario() {
    if (args['help']) {
        console.log("Options: ");
        console.log("--remoteEndpointIP=[IP]             Use an ETH endpoint remote to the Uniswap Bot *.*.*.*");
        console.log("--tokenAddress=[tokenAddress]       The eth blockchain address of the token to trade");
        console.log("--PK=[PRIVATE_KEY]                  The private key of the wallet to use");
        console.log("--slippageBuy=15                    Percentage of price variation tolerated when buying");
        console.log("--slippageSell=5                    Percentage of price variation tolerated when selling");
        console.log("--profitTarget=150                  The target at where to sell vs original spent ETH");
        console.log("--lossTrigger=75                    The target at where to stop monitoring and sell");
        console.log("--etherTargetLiquidity=25           Minimum ETH on liquidity transaction to trigger trading");
        process.exit(0);
    }

    if (args['remoteEndpointIP']) {
        Scenario.ethEndpoint = args['remoteEndpointIP'];
    }

    if (args['tokenAddress']) {
        Scenario.tokenAddress = args['tokenAddress'];
    }

    if (args['PK']) {
        Scenario.PK = args['PK'];
    }

    if (args['slippageBuy']) {
        Scenario.slippageBuy = args['slippageBuy'];
    }

    if (args['slippageSell']) {
        Scenario.slippageSell = args['slippageSell'];
    }

    if (args['profitTarget']) {
        Scenario.profitTarget = args['profitTarget'];
    }

    if (args['lossTrigger']) {
        Scenario.lossTrigger = args['lossTrigger'];
    }

    if (args['etherTargetLiquidity']) {
        Scenario.etherTargetLiquidity = args['etherTargetLiquidity'];
    }
}

setUpScenario();
es.init(Scenario).then();
es.start_Bot().then();

