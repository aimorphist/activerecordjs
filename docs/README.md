# Bagpipe

> Programmable token flow router for Solana. A transistor for money.

```
INPUT ──▶ [ ESCROW ] ──▶ [ DECIDER ] ──▶ OUTPUT
           (custody)      (lambda)      (wallet | pipe)
```

## What is this?

Bagpipe routes token streams through programmable pipes. Primary use case: redirecting [Bags.fm](https://bags.fm) creator royalties to arbitrary destinations with custom logic.

**Key features:**

- **Escrow custody** - Bagpipe holds funds in controlled wallets
- **Turing-complete routing** - Decider logic can do anything (fetch APIs, time-based rules, price feeds)
- **Recursive pipes** - Output of one pipe → input of another
- **Bags integration** - Claim aggregation across all positions

## Use Cases

- **NPM guy problem**: Someone made a memecoin of your IP, you don't want it → pipe to charity
- **Royalty splits**: 50% to artist, 30% to manager, 20% to label
- **Time-based routing**: Weekday earnings to savings, weekend to spending
- **Threshold-based**: Accumulate until $1000, then distribute
- **Conditional**: If SOL > $200, take profits; otherwise hold

## Quick Start

```typescript
import { Bagpipe, StaticDecider } from 'bagpipe';

// Create a pipe that splits 60/40
const pipe = await bagpipe.createPipe({
	name: 'my-royalty-split',
	decider: new StaticDecider([
		{ address: ARTIST_WALLET, shareBps: 6000 },
		{ address: MANAGER_WALLET, shareBps: 4000 }
	]),
	triggerMode: { type: 'threshold', amountLamports: 1_000_000_000n } // 1 SOL
});

// Trigger manually
await bagpipe.trigger(pipe.id);

// Or let scheduler handle threshold/cron triggers
```

## Architecture

See [DESIGN.md](./DESIGN.md) for full architecture documentation.

## Status

🚧 **Pre-alpha** - Design phase

## License

MIT
