import { prisma } from '../config/prisma.js'

export class BusinessService {
  async create(name: string) {
    return prisma.business.create({
      data: {
        name
      }
    })
  }

  async findAll() {
    return prisma.business.findMany()
  }

  async update(id: string, data: { name?: string; logoUrl?: string | null }) {
    const business = await prisma.business.findUnique({
      where: {
        id
      }
    })

    if (!business) {
      return null
    }

    return prisma.business.update({
      where: {
        id
      },
      data
    })
  }
}
