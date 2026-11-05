# ActiveRecordJS

ActiveRecord ergonomics for TypeScript, built on Drizzle.

The library is the whole project. Models wrap Drizzle tables. Conventions cover names, primary keys, timestamps, validations, hooks, and associations. Drop to Drizzle when you need the SQL.

```typescript
import { Model, z } from 'activerecordjs';
import { users } from './schema';

export class User extends Model(users) {
	static validations = {
		email: z.string().email()
	};

	static hasMany = {
		posts: { model: () => Post }
	};
}
```

See [docs/PRD.md](./docs/PRD.md) for the shape this is growing into.

## Tests

Unit tests need no database:

```
bun run test:unit
```

Integration tests use Postgres. `docker compose up -d` starts one on port 5433, and the default URL is `postgresql://activerecordjs:activerecordjs@localhost:5433/activerecordjs_test`.

```
bun run test:integration
```

## Status

Hollow library extracted from Bagpipe. The ActiveRecord work through AR6 is here. The Solana router is not.
