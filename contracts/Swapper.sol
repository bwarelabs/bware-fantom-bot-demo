pragma solidity =0.6.6;

contract Swapper {

    address public owner;
    mapping(address => bool) public isSwapper;
    mapping(address => uint256) private ethereumSwapped;

    address private constant uniswap_router_v2 = address(0xF491e7B69E4244ad4002BC14e878a34207E38c29);
    address private constant uniswap_factory_v2 = address(0x152eE697f2E276fA89E96742e9bB9aB1F2E61bE3);

    address public addressToken;
    uint256 public percentLoss;
    uint256 public percentGain;

    constructor () public {
        owner = msg.sender;
        isSwapper[owner] = true;
    }

    modifier onlyOwner {
        require(msg.sender == owner, "only owner can call this function.");
        _;
    }

    modifier onlySwapper {
        require(isSwapper[msg.sender], "only a swapper can call this function");
        _;
    }

    receive() payable external {
        //call your function here / implement your actions
    }

    fallback() payable external {
        //call your function here / implement your actions
    }

    function addSwappers(address[] calldata accounts) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            isSwapper[accounts[i]] = true;
        }
    }

    function removeSwappers(address[] calldata accounts) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            isSwapper[accounts[i]] = false;
        }
    }

    function configToken(address token, uint256 loss, uint256 gain) external onlyOwner {
        addressToken = token;
        percentLoss = loss;
        percentGain = gain;
    }

    function configToken(address token) external onlyOwner {
        addressToken = token;
        percentLoss = 100;
        percentGain = 0;
    }

    function withdrawETH() external onlySwapper {
        payable(owner).transfer(address(this).balance);
    }

    function withdrawToken() external onlySwapper {
        (, bytes memory balance) = addressToken.call(abi.encodeWithSignature("balanceOf(address)", address(this)));
        (bool success,) = addressToken.call(
            abi.encodeWithSignature("transfer(address,uint256)",
            owner,
            abi.decode(balance, (uint256)))
        );
        require(success, "withdraw of tokens to owner failed");
    }

    event Address(address pair);
    event TokensAmount(uint256 amount);
    event EtherAmount(uint256 amount);
    event Reserves(uint256 ethReserve, uint256 tokenReserve);


    function getReserves() private returns (uint256, uint256, address) {
        (, bytes memory result) = uniswap_router_v2.call(abi.encodeWithSignature("WETH()"));
        address addressWETH = abi.decode(result, (address));

        // sort the tokens addresses
        (address token0, address token1) = addressWETH < addressToken ?
        (addressWETH, addressToken) : (addressToken, addressWETH);

        bool success;
        (success, result) = uniswap_factory_v2.call(abi.encodeWithSignature("getPair(address,address)", token0, token1));
        require(success, "could not fetch token pair address");
        address addressPair = abi.decode(result, (address));
        emit Address(addressPair);

        (success, result) = addressPair.call(abi.encodeWithSignature("getReserves()"));
        require(success, "could not fetch pair reserves");
        (uint256 reserve0, uint256 reserve1,) = abi.decode(result, (uint256, uint256, uint32));

        (reserve0, reserve1) = addressWETH == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
        emit Reserves(reserve0, reserve1);
        return (reserve0, reserve1, addressWETH);
    }

    function buy() external onlySwapper {
        require(ethereumSwapped[addressToken] == 0, "already performed the buy swap");
        require(address(this).balance > 0, "zero ethereum to sell");

        (uint256 reserveETH, uint256 reserveToken, address addressWETH) = getReserves();
        require(reserveETH > 0 && reserveToken > 0, "no liquidity in the pool");

        uint256 ethereumIn = address(this).balance;
        uint256 amountInWithFee = ethereumIn * 997;
        uint256 numerator = amountInWithFee * reserveToken;
        uint256 denominator = reserveETH * 1000 + amountInWithFee;
        uint256 amountOutMin = numerator / denominator;

        address[] memory path = new address[](2);
        path[0] = addressWETH;
        path[1] = addressToken;

        (bool success, bytes memory result) = uniswap_router_v2.call{gas : gasleft(), value : ethereumIn}(
            abi.encodeWithSignature(
                "swapExactETHForTokens(uint256,address[],address,uint256)",
                amountOutMin,
                path,
                address(this),
                block.timestamp)
        );
        require(success, "the buy transaction failed");
        uint256 tokensOut = abi.decode(result, (uint256[]))[1];

        ethereumSwapped[addressToken] = ethereumIn;
        emit EtherAmount(ethereumIn);
        emit TokensAmount(tokensOut);
    }

    function approveDEX() private {
        uint256 MAX_INT = 2 ** 256 - 1;
        (bool success,) = addressToken.call(abi.encodeWithSignature(
                "approve(address,uint256)",
                uniswap_router_v2,
                MAX_INT)
        );
        require(success, "could not approve DEX");
    }

    function sell() external onlySwapper {
        (, bytes memory balance) = addressToken.call(abi.encodeWithSignature("balanceOf(address)", this));
        uint256 tokensIn = abi.decode(balance, (uint256));
        require(tokensIn > 0, "zero tokens to sell");

        (uint256 reserveETH, uint256 reserveToken, address addressWETH) = getReserves();
        uint256 amountInWithFee = tokensIn * 997;
        uint256 numerator = amountInWithFee * reserveETH;
        uint256 denominator = reserveToken * 1000 + amountInWithFee;
        uint256 amountOutMin = numerator / denominator;

        if (amountOutMin <= (percentLoss * ethereumSwapped[addressToken] / 100) ||
            amountOutMin >= (percentGain * ethereumSwapped[addressToken] / 100)) {

            approveDEX();

            address[] memory path = new address[](2);
            path[0] = addressToken;
            path[1] = addressWETH;

            (bool success, bytes memory result) = uniswap_router_v2.call{gas : gasleft()}(abi.encodeWithSignature(
                    "swapExactTokensForETH(uint256,uint256,address[],address,uint256)",
                    tokensIn,
                    amountOutMin,
                    path,
                    owner,
                    block.timestamp)
            );
            require(success, "the sell transaction failed");
            uint256 ethereumOut = abi.decode(result, (uint256[]))[1];

            emit EtherAmount(ethereumOut);
            emit TokensAmount(tokensIn);
            ethereumSwapped[addressToken] = 0;
        }
        else {
            require(false, "loss/gain bounds were not hit");
        }
    }
}