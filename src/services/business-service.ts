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
}
