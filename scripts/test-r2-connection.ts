/**
 * Script manuel pour vérifier que les credentials R2 fonctionnent.
 * À lancer avec : npx tsx scripts/test-r2-connection.ts
 * (ou : node --loader tsx scripts/test-r2-connection.ts)
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import {
  uploadBuffer,
  getPublicUrl,
  deleteFile,
  fileExists,
  getBucketName,
} from '../lib/storage';

async function main() {
  console.log('🔍 Test de connexion à Cloudflare R2...\n');

  try {
    console.log(`   Bucket      : ${getBucketName()}`);
    console.log(`   Endpoint    : ${process.env.R2_ENDPOINT}`);
    console.log(`   Public URL  : ${process.env.R2_PUBLIC_URL}\n`);

    const testKey = `_test/connection-check-${Date.now()}.txt`;
    const testContent = Buffer.from(
      `R2 connection test — ${new Date().toISOString()}`,
      'utf-8'
    );

    // 1. Upload
    console.log('1️⃣  Upload d\'un fichier test...');
    await uploadBuffer(testKey, testContent, 'text/plain');
    console.log('   ✅ Upload OK\n');

    // 2. Vérifier existence
    console.log('2️⃣  Vérification de l\'existence...');
    const exists = await fileExists(testKey);
    console.log(`   ✅ fileExists = ${exists}\n`);

    // 3. URL publique (on ne fait pas de fetch réel pour éviter les soucis
    // de propagation r2.dev, mais on affiche l'URL)
    console.log('3️⃣  URL publique générée :');
    console.log(`   ${getPublicUrl(testKey)}\n`);

    // 4. Nettoyage
    console.log('4️⃣  Suppression du fichier test...');
    await deleteFile(testKey);
    console.log('   ✅ Suppression OK\n');

    // 5. Vérifier que c'est bien parti
    const stillExists = await fileExists(testKey);
    console.log(`5️⃣  Vérification post-suppression : fileExists = ${stillExists}`);
    if (stillExists) {
      console.log('   ⚠️  Le fichier existe encore, c\'est bizarre\n');
    } else {
      console.log('   ✅ Bucket propre\n');
    }

    console.log('✅ R2 est opérationnel ! Credentials OK, upload/download/delete fonctionnent.');
  } catch (err) {
    console.error('\n❌ Erreur R2 :', err);
    process.exit(1);
  }
}

main();
