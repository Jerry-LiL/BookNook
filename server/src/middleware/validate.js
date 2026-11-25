export function validate(schema, source) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || source,
          message: issue.message,
        })),
      });
      return;
    }
    req[source] = parsed.data;
    next();
  };
}
