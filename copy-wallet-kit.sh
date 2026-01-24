
  #!/bin/bash

  SOURCE_DIR="/Users/dukejones/work/StartupCentral/startdotfun/packages/solana-wallet-kit"
  TARGET_DIR="." # Current directory (your target repo)

  echo "📦 Copying Wallet Kit to inline structure..."

  # Create directories
  mkdir -p src/lib/wallet
  mkdir -p src/lib/server/db
  mkdir -p src/routes/api/wallet
  mkdir -p docs

  # Copy core library
  echo "✓ Copying core library..."
  rsync -av --progress \
    "$SOURCE_DIR/src/lib/wallet/" \
    "$TARGET_DIR/src/lib/wallet/"

  # Copy database schema example
  echo "✓ Copying database schema..."
  rsync -av --progress \
    "$SOURCE_DIR/src/lib/server/db/" \
    "$TARGET_DIR/src/lib/server/db/"

  # Copy API route examples
  echo "✓ Copying API route examples..."
  rsync -av --progress \
    "$SOURCE_DIR/src/routes/api/wallet/" \
    "$TARGET_DIR/src/routes/api/wallet/"

  # Copy documentation
  echo "✓ Copying documentation..."
  cp "$SOURCE_DIR/README.md" "$TARGET_DIR/docs/WALLET_KIT.md"
  cp "$SOURCE_DIR/TESTS.md" "$TARGET_DIR/docs/WALLET_KIT_TESTS.md"
  cp "$SOURCE_DIR/IMPLEMENTATION_SUMMARY.md" "$TARGET_DIR/docs/WALLET_KIT_IMPLEMENTATION.md"

  echo "✅ Wallet Kit copied successfully!"
  echo ""
  echo "📝 Next steps:"
  echo "1. Run: bun add @solana/wallet-adapter-base @solana/wallet-adapter-phantom @solana/wallet-adapter-solflare @solana/wallet-adapter-backpack @wallet-standard/app tweetnacl bs58
  @solana/web3.js"
  echo "2. Rename *.example.ts files in src/routes/api/wallet/ to +server.ts"
  echo "3. Implement the database stores in src/lib/server/db/schema.ts"
  echo "4. Update environment variables (ALLOWED_ORIGINS, etc.)"
  echo "5. See docs/WALLET_KIT.md for usage examples"
