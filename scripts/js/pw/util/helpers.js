const BN = require('bn.js');
const sleep = require('p-sleep');
const { getSpiritCollectionId, getOriginOfShellCollectionId, getShellCollectionId, getShellPartsCollectionId, getNftInfo } = require('./fetch');
const bnUnit = new BN(1e12);
function token(n) {
    return new BN(n).mul(bnUnit);
}

async function getCollectionType(khalaApi, collectionType) {
    let collectionId = -1;
    if (collectionType === "spirit") {
        collectionId = await getSpiritCollectionId(khalaApi);
    } else if (collectionType === "originOfShell") {
        collectionId = await getOriginOfShellCollectionId(khalaApi);
    } else if (collectionType === "shell") {
        collectionId = await getShellCollectionId(khalaApi);
    } else if (collectionType === "shellParts") {
        collectionId = await getShellPartsCollectionId(khalaApi);
    } else {
        return collectionId;
    }
    return collectionId;
}

async function checkUntil(async_fn, timeout) {
    const t0 = new Date().getTime();
    while (true) {
        if (await async_fn()) {
            return true;
        }
        const t = new Date().getTime();
        if (t - t0 >= timeout) {
            return false;
        }
        await sleep(100);
    }
}

async function getNonce(khalaApi, address) {
    const info = await khalaApi.query.system.account(address);
    return info.nonce.toNumber();
}

async function waitTxAccepted(khalaApi, account, nonce) {
    await checkUntil(async () => {
        return await getNonce(khalaApi, account) === nonce + 1;
    });
}

function extractTxResult(events, expectPallet, expectFunction) {
    let success = false;
    events.forEach(({event: {data, func, section}}) => {
        if (func === 'ExtrinsicSuccess') {
            success = true;
        }
    });
    return success;
}

function extractPwNftSaleTxResult(events, expectFunction) {
    return extractTxResult(events, 'pwNftSale', expectFunction);
}

function waitExtrinsicFinished(khalaApi, extrinsic, account) {
    return new Promise(async (resolve, reject) => {
        try {
            await extrinsic.signAndSend(account, ({events, status}) => {
                if(!status.isInBlock && !status.isFinalized) return;
                for (const {event} of events) {
                    if (khalaApi.events.system.ExtrinsicSuccess.is(event)) {
                        resolve(true);
                    } else if (khalaApi.events.system.ExtrinsicFailed.is(event)) {
                        const {data: [error]} = event;
                        if (error.isModule) {
                            const decoded = khalaApi.registry.findMetaError(error.asModule);
                            const {method, section} = decoded;
                            console.log(`\tError: ${section}.${method}`);
                            reject(false);
                        } else {
                            console.log(`\tError: ${error.toString()}`);
                            reject(false);
                        }
                    }
                }
            });
        } catch (e) {
            reject(false);
        }
    });
}

// Create Whitelist for account and sign with Overlord
async function createWhitelistMessage(khalaApi, type, overlord, account) {
    const whitelistMessage = khalaApi.createType(type, {'account': account.address, 'purpose': 'BuyPrimeOriginOfShells'});
    return overlord.sign(whitelistMessage.toU8a());
}

async function getTopNFed(khalaApi, era, sliceNSize) {
    const originOfShellFoodStats = await khalaApi.query.pwIncubation.originOfShellFoodStats.entries(era);
    const sortedOriginOfShellStats = originOfShellFoodStats
        .map(([key, value]) => {
                const eraId = key.args[0].toNumber()
                const collectionIdNftId = key.args[1].toHuman()
                const numTimesFed = value.toNumber()
                return {
                    eraId: eraId,
                    collectionIdNftId: collectionIdNftId,
                    numTimesFed: numTimesFed
                }
            }
        ).sort((a, b) => b.numTimesFed - a.numTimesFed);
    return sortedOriginOfShellStats.slice(0, sliceNSize);
}

async function getNonTransferableNft(khalaApi, collectionId, nfts) {
    for (const nft in nfts) {
        let nftInfo = await getNftInfo(khalaApi, collectionId, nft);
        if (nftInfo.isSome) {
            let nftInfoUnwrap = nftInfo.unwrap();
            if (nftInfoUnwrap.transferable) {
                return nft;
            }
        }
    }
    return -1;
}

module.exports = {
    getNonce,
    checkUntil,
    extractTxResult,
    extractPwNftSaleTxResult,
    getCollectionType,
    waitTxAccepted,
    waitExtrinsicFinished,
    token,
    createWhitelistMessage,
    getTopNFed,
    getNonTransferableNft
}