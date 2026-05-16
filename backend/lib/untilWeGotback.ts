import { createClient } from "redis"

const subscriber = createClient()

await subscriber.connect()

export const QUEUE_ID = Math.random()
let pendingResolves = {}

async function pollQueue() {
    const response = await subscriber.brPop('response-queue-' + QUEUE_ID, 5)
    if (!response) {
        pollQueue()
    } else {
        const parsedResponse = JSON.parse(response.element)

        if (parsedResponse.identifier && pendingResolves[parsedResponse.identifier]) {
            pendingResolves[parsedResponse.identifier]({filledQty: parsedResponse.filledQty})
        }
        pollQueue()
    }
}

pollQueue()

export async function untilWeGotback(identifier: number) {
    return new Promise((resolve, reject) => {
        pendingResolves[identifier] = resolve;
    })
}