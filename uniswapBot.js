const es = require('./uniswapSwapper');


let Scenario = new Object();
Scenario.endpoint = "";
Scenario.tokenAddress = "";
Scenario.PK = "";
Scenario.botAddress = "";

Scenario.targetProfit = 150; //profit target in percents relative to the amount of ETH invested 200%
Scenario.targetLoss = 75; //sell tokens if current price gives us back ETH less than this percent of the invested one
Scenario.gasPriceIncrease = 1.5; //in percentage. Ex 1.2 will mean gas price is 120% fastest gas possible
Scenario.gasLimitDefault = 300000; //the default gas limit in computation units for a swap transaction
Scenario.blockRetryCount = 10; //how many blocks after the buy to examine (for target profit/loss) until forcefully selling
Scenario.routerV2Address = "0xF491e7B69E4244ad4002BC14e878a34207E38c29";

const args = require('minimist')(process.argv.slice(2), {
    string: ['endpoint', 'tokenAddress', 'PK', 'botAddress'],
});

function setUpScenario() {
    if (args['help']) {
        console.log("Options: ");
        console.log("--endpoint=[IP]                     Use an ETH endpoint remote to the Uniswap Bot *.*.*.*");
        console.log("--tokenAddress=[TOKEN_ADDR]         The blockchain address of the token to trade");
        console.log("--botAddress=[BOT_ADDR]             The blockchain address of the bot swapper SC");
        console.log("--PK=[PK]                           The private key of the wallet to use");
        console.log("--targetProfit=150                  The target at where to sell vs original spent ETH");
        console.log("--targetLoss=75                     The target at where to stop monitoring and sell");
        process.exit(0);
    }

    if (args['endpoint']) {
        Scenario.endpoint = args['endpoint'];
    }

    if (args['tokenAddress']) {
        Scenario.tokenAddress = args['tokenAddress'];
    }

    if (args['botAddress']) {
        Scenario.botAddress = args['botAddress'];
    }

    if (args['PK']) {
        Scenario.PK = args['PK'];
    }

    if (args['targetProfit']) {
        Scenario.targetProfit = args['targetProfit'];
    }

    if (args['targetLoss']) {
        Scenario.targetLoss = args['targetLoss'];
    }
}

setUpScenario();
es.init(Scenario).then();
es.start_Bot().then();
