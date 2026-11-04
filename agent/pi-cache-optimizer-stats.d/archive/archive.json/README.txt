pi-cache-optimizer stores its stats archive in the archive.<generation>.json files next to this directory.
This directory replaces the single archive.json of version 2.9.0 so that 2.9.0 can no longer write it
(it would publish without a compare-and-swap). 2.9.0 reports the archive as unreadable and keeps raw shards.
Do not remove it while any Pi process might still run pi-cache-optimizer 2.9.0.
