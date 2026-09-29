import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: "postgresql://postgres:postgres@localhost:5432/codeduo",
});

export const prisma = new PrismaClient({
  adapter,
});