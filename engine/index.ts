import { createClient } from "redis"

const client = createClient()
await client.connect()

const publisher = createClient()
await publisher.connect()

const BALANCES = {
    available: {
        "user1": { BTC: 1, USDT: 10000 },
        "user2": { BTC: 2, USDT: 50000 }
    },
    locked: {
        "user1": { BTC: 0, USDT: 0 },
        "user2": { BTC: 0, USDT: 0 }
    }
}

const ORDERBOOKS = {
    SOL: { bids: [], asks: [] },
    BTC: { bids: [], asks: [] }
}

function checkBalance(userId: string, asset: string, amount: number): boolean {
    if (!BALANCES.available[userId]) {
        return false;
    } else {
        return (BALANCES.available[userId][asset] || 0) >= amount
    }
}

function lockBalance(userId: string, asset: string, amount: number) {
    BALANCES.available[userId] -= amount
    BALANCES.locked[userId][asset] = (BALANCES.locked[userId][asset] || 0) + amount
}

function unlockAndSettle(
    buyerId: string,
    sellerId: string,
    asset: string,        // BTC
    quoteAsset: string,   // USDT
    qty: number,
    price: number
) {
    const total = qty * price

    // Buyer gets BTC
    BALANCES.available[buyerId][asset] = (BALANCES.available[buyerId][asset] || 0) + qty
    // Buyer's USDT locked gets reduced
    BALANCES.locked[buyerId][quoteAsset] = (BALANCES.locked[buyerId][quoteAsset] || 0) - total

    // Seller gets USDT
    BALANCES.available[sellerId][quoteAsset] = (BALANCES.available[sellerId][quoteAsset] || 0) + total
    // Seller's BTC locked gets reduced
    BALANCES.locked[sellerId][asset] = (BALANCES.locked[sellerId][asset] || 0) - qty
}

function matchOrder(
    userId: string,
    side: string,
    symbol: string,
    price: number,
    qty: number,
    orderId: string
): number {
    const book = ORDERBOOKS[symbol]
    if (!book) return 0

    let remainingQty = qty
    let filledQty = 0

    if (side === 'buy') {
        // Sort asks low to high — cheapest sell first
        book.asks.sort((a, b) => a.price - b.price)

        for (let i = 0; i < book.asks.length; i++) {
            const ask = book.asks[i]

            // Can we match?
            if (ask.price > price) break

            const fill = Math.min(remainingQty, ask.qty)
            remainingQty -= fill
            ask.qty -= fill
            filledQty += fill

            // Settle balances
            unlockAndSettle(userId, ask.userId, symbol, 'USDT', fill, ask.price)

            // Remove ask if fully filled
            if (ask.qty === 0) {
                book.asks.splice(i, 1)
                i--
            }

            if (remainingQty === 0) break
        }

        // Whatever is left goes into order book as a waiting bid
        if (remainingQty > 0) {
            book.bids.push({ price, qty: remainingQty, userId, orderId })
            // Lock remaining USDT
            lockBalance(userId, 'USDT', remainingQty * price)
        }

    } else {
        // SELL — sort bids high to low — highest buyer first
        book.bids.sort((a, b) => b.price - a.price)

        for (let i = 0; i < book.bids.length; i++) {
            const bid = book.bids[i]

            if (bid.price < price) break

            const fill = Math.min(remainingQty, bid.qty)
            remainingQty -= fill
            bid.qty -= fill
            filledQty += fill

            // Settle balances
            unlockAndSettle(bid.userId, userId, symbol, 'USDT', fill, bid.price)

            if (bid.qty === 0) {
                book.bids.splice(i, 1)
                i--
            }

            if (remainingQty === 0) break
        }

        // Whatever is left goes into order book as a waiting ask
        if (remainingQty > 0) {
            book.asks.push({ price, qty: remainingQty, userId, orderId })
            // Lock remaining BTC
            lockBalance(userId, symbol, remainingQty)
        }
    }

    return filledQty
}


while (true) {
    const response = await client.brPop('incoming-order', 0)
    if (!response) continue

    const order = JSON.parse(response.element)
    const { type, side, price, qty, symbol, userId, identifier, queue_id } = order

    let filledQty = 0

    if (type === 'limit') {
        if (side === 'buy') {
            const required = price * qty
            if (!checkBalance(userId, 'USDT', required)) {
                await publisher.lPush('response-queue-' + queue_id, JSON.stringify({
                    identifier,
                    filledQty: 0,
                    error: 'Insufficient USDT balance'
                }))
                continue
            }
        } else {
            if (!checkBalance(userId, symbol, qty)) {
                await publisher.lPush('response-queue-' + queue_id, JSON.stringify({
                    identifier,
                    filledQty: 0,
                    error: 'Insufficient balance'
                }))
                continue
            }
            // Lock BTC upfront for sell order
            lockBalance(userId, symbol, qty)
        }

        filledQty = matchOrder(userId, side, symbol, price, qty, identifier)
    }

    await publisher.lPush('response-queue-' + queue_id, JSON.stringify({
        identifier,
        filledQty 
    }))
}
