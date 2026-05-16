import { createClient } from "redis"

const client = createClient()

await client.connect()

const publisher = createClient()

await publisher.connect()

const BALANCES = {
    available: {},
    locked: {}
}

const ORDERBOOKS = {
    SOL: {},
    BTC: {}
}

while(1) {
    const response = await client.brPop('incoming-order', 5)
    if (!response) {
        continue
    }

    const parsedResponse = JSON.parse(response.element)

    const filledQty = parsedResponse.price
    const identifier = parsedResponse.identifier

    await publisher.lPush('response-queue-' + parsedResponse.queue_id, JSON.stringify({
        filledQty, 
        identifier
    }))
}
