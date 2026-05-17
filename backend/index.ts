import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { signinSchema, signupSchema } from './lib/auth-schema'
import { prisma } from './lib/db'
import authMiddleware from './lib/middleware'
import { createClient } from 'redis'
import { untilWeGotback, QUEUE_ID } from './lib/untilWeGotback'

const client = createClient()

await client.connect()
    

const app = express()

app.use(express.json())


app.post('/signup', async (req, res) => {
    try {
        const parsedResult = signupSchema.safeParse(req.body)
        if (!parsedResult.success) {
            return res.status(400).json({
                error: 'All fields required'
            })
        }

        const { name, email, password } = parsedResult.data
        
        const existingUser = await prisma.user.findFirst({
            where: {
                email
            }
        })
        if (existingUser) {
            return res.status(400).json({
                error: 'User already exist'
            })
        }

        const hashedPassword = await bcrypt.hash(password, 10)

        await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword
            }
        })

        res.status(201).json({
            message: 'Signup done'
        })
    } catch (e) {
        res.status(500).json({
            error: 'Signup Failed'
        })
    }
})

app.post('/signin', async (req, res) => {
    try {
        const parsedResult = signinSchema.safeParse(req.body)
        if (!parsedResult.success) {
            return res.status(400).json({
                error: 'All fields required'
            })
        }

        const { email, password } = parsedResult.data;
        
        const user = await prisma.user.findFirst({
            where:{
                email
            }
        })
        if (!user) {
            return res.status(400).json({
                error: 'User not found'
            })
        }

        const isValidPassword = await bcrypt.compare(password, user.password)
        if (!isValidPassword) {
            return res.status(400).json({
                error: 'Invalid password'
            })
        }

        const token = jwt.sign({
            userId: user.id
        }, process.env.JWT_SECRET!)

        res.status(200).json({
            token
        })
    } catch (e) {
        res.status(500).json({
            error: 'Signin failed'
        })
    }
})

app.post('/order', authMiddleware, async (req, res) => {
    const userId = req.userId
    const { type, price, qty, market_id, side, symbol } = req.body;
    
    let identifier = Math.random()
    const callbackResponse = untilWeGotback(identifier)
    
    await client.lPush('incoming-order', JSON.stringify({
        type, price, qty, market_id, side, symbol, userId, identifier, queue_id: QUEUE_ID
    }))

    const returnedData = await callbackResponse

    res.json({
        message: 'order placed',
        filledQty: returnedData.filledQty
    })

})

app.listen(3000, () => {
    console.log('Port is listening on 3000')
})
