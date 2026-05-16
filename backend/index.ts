import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { signinSchema, signupSchema } from './lib/auth-schema'
import { prisma } from './lib/db'

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

app.listen(3000, () => {
    console.log('Port is listening on 3000')
})

