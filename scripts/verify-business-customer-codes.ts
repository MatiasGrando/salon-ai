import { prisma } from '../src/config/prisma.js'

const businesses = await prisma.business.findMany({
  select: {
    name: true,
    customerCode: true
  },
  orderBy: { name: 'asc' }
})
const uniqueCodes = new Set(businesses.map((business) => business.customerCode))

console.log(JSON.stringify({
  total: businesses.length,
  withoutCode: businesses.filter((business) => !business.customerCode).length,
  uniqueCodes: uniqueCodes.size,
  businesses
}, null, 2))

await prisma.$disconnect()
