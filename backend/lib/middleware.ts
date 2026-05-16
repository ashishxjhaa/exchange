import jwt from 'jsonwebtoken'

const authMiddleware = (req: any, res: any, next: any) => {
    const authHeaders = req.headers.authorization;
    if (!authHeaders || !authHeaders.startsWith('Bearer ')) {
        return res.status(411).json({
            error: 'Token is missing'
        })
    }

    const token = authHeaders.split(' ')[1]

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
        req.userId = decoded.userId
        next()
    } catch (e) {
        res.status(411).json({
            error: 'Invalid token'
        })
    }
}

export default authMiddleware
