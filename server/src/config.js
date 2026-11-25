const DEV_SECRET = 'dev-only-change-me';

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://booknook:booknook@localhost:5432/booknook',
  jwtSecret: process.env.JWT_SECRET || DEV_SECRET,
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
};

if (process.env.NODE_ENV === 'production' && config.jwtSecret === DEV_SECRET) {
  throw new Error('Set JWT_SECRET before running in production');
}
