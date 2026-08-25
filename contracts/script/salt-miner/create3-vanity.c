// SPDX-License-Identifier: MIT
//
// create3-vanity — mine CreateX permissioned CREATE3 salts whose deployed address carries a
// leading run of zero bytes.
//
// ── The address derivation this reproduces ────────────────────────────────────────────────────
// A CreateX salt is three fields packed into 32 bytes:
//
//     salt[0..19]   the deployer address        (permissioned-deploy guard: CreateX requires
//                                                msg.sender to equal these 20 bytes)
//     salt[20]      cross-chain redeploy flag   (0x00 = off, 0x01 = mix block.chainid into the
//                                                guarded salt; this miner mines the 0x00 form,
//                                                which is what the deploy script uses)
//     salt[21..31]  free entropy                (88 bits — the only field mined here)
//
// With the flag off, CreateX guards the salt as
//
//     guardedSalt = keccak256(abi.encodePacked(uint256(uint160(deployer)), salt))
//
// and then derives the CREATE3 address in the usual two steps: a CREATE2 proxy from the CreateX
// factory under the guarded salt, then the address that proxy's first (nonce-1) CREATE produces.
//
//     proxy   = last20( keccak256(0xff ++ CREATEX ++ guardedSalt ++ PROXY_INITCODE_HASH) )
//     address = last20( keccak256(0xd6 ++ 0x94 ++ proxy ++ 0x01) )
//
// Three keccak-f1600 permutations per candidate, no secp256k1, no contract code involved — the
// deployed bytecode never enters the derivation, so one mined salt is valid for any contract
// deployed through CreateX's CREATE3 entry point by that deployer.
//
// ── Build & run ───────────────────────────────────────────────────────────────────────────────
//     cc -O3 -march=native -pthread -o create3-vanity create3-vanity.c
//     ./create3-vanity --deployer 0x<20-byte address> --prefix-bytes 4 --count 6
//
//     --deployer      the address that will broadcast the deploy (REQUIRED; a salt is bound to it)
//     --prefix-bytes  how many leading 0x00 bytes the address must have (default 4)
//     --count         how many distinct salts to mine (default 6)
//     --threads       worker threads (default: all online CPUs)
//     --seed          64-bit entropy seed (default: /dev/urandom, or time)
//     --verify 0x..   derive and print the address for one salt, then exit (no mining)
//
// Expected work: a K-zero-byte prefix is one hit per 2^(8K) candidates. Measure your own
// throughput from the progress line; the cost per extra zero byte is 256x.

#define _GNU_SOURCE
#include <inttypes.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

// ── keccak-f1600 ──────────────────────────────────────────────────────────────────────────────

static const uint64_t RC[24] = { 0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL,
    0x8000000080008000ULL, 0x000000000000808bULL, 0x0000000080000001ULL, 0x8000000080008081ULL,
    0x8000000000008009ULL, 0x000000000000008aULL, 0x0000000000000088ULL, 0x0000000080008009ULL,
    0x000000008000000aULL, 0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL,
    0x8000000000008003ULL, 0x8000000000008002ULL, 0x8000000000000080ULL, 0x000000000000800aULL,
    0x800000008000000aULL, 0x8000000080008081ULL, 0x8000000000008080ULL, 0x0000000080000001ULL,
    0x8000000080008008ULL };

static const int ROT[25] = { 0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18,
    2, 61, 56, 14 };

#define ROTL64(x, n) (((n) == 0) ? (x) : (((x) << (n)) | ((x) >> (64 - (n)))))

static inline void keccakf(uint64_t a[25])
{
    for (int round = 0; round < 24; round++) {
        uint64_t c[5], d[5], b[25];
        for (int x = 0; x < 5; x++) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
        for (int x = 0; x < 5; x++) d[x] = c[(x + 4) % 5] ^ ROTL64(c[(x + 1) % 5], 1);
        for (int x = 0; x < 5; x++)
            for (int y = 0; y < 5; y++) a[x + 5 * y] ^= d[x];
        for (int x = 0; x < 5; x++)
            for (int y = 0; y < 5; y++) {
                int i = x + 5 * y;
                b[y + 5 * ((2 * x + 3 * y) % 5)] = ROTL64(a[i], ROT[i]);
            }
        for (int x = 0; x < 5; x++)
            for (int y = 0; y < 5; y++) {
                int i = x + 5 * y;
                a[i] = b[i] ^ ((~b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y]);
            }
        a[0] ^= RC[round];
    }
}

// keccak256 for a single-block message (len < 136). Little-endian host assumed (x86-64/aarch64).
static inline void keccak256(const uint8_t *in, size_t len, uint8_t out[32])
{
    uint64_t st[25];
    uint8_t buf[136];
    memset(st, 0, sizeof(st));
    memset(buf, 0, sizeof(buf));
    memcpy(buf, in, len);
    buf[len] = 0x01;
    buf[135] |= 0x80;
    for (int i = 0; i < 17; i++) {
        uint64_t w;
        memcpy(&w, buf + 8 * i, 8);
        st[i] ^= w;
    }
    keccakf(st);
    memcpy(out, st, 32);
}

// ── CREATE3 derivation ────────────────────────────────────────────────────────────────────────

static const uint8_t CREATEX[20] = { 0xba, 0x5e, 0xd0, 0x99, 0x63, 0x3d, 0x3b, 0x31, 0x3e, 0x4d, 0x5f, 0x7b,
    0xdc, 0x13, 0x05, 0xd3, 0xc2, 0x8b, 0xa5, 0xed };

// keccak256(hex"67363d3d37363d34f03d5260086018f3") — the CreateX CREATE3 proxy init code.
static const uint8_t PROXY_INITCODE_HASH[32] = { 0x21, 0xc3, 0x5d, 0xbe, 0x1b, 0x34, 0x4a, 0x24, 0x88, 0xcf,
    0x33, 0x21, 0xd6, 0xce, 0x54, 0x2f, 0x8e, 0x9f, 0x30, 0x55, 0x44, 0xff, 0x09, 0xe4, 0x99, 0x3a, 0x62,
    0x31, 0x9a, 0x49, 0x7c, 0x1f };

// guarded-salt preimage: 32-byte left-padded deployer ++ 32-byte salt
// create2 preimage:      0xff ++ CREATEX ++ guardedSalt ++ PROXY_INITCODE_HASH
// rlp preimage:          0xd6 ++ 0x94 ++ proxy ++ 0x01
static inline void derive_address(const uint8_t guard_in[64], uint8_t addr_out[20])
{
    uint8_t guarded[32], c2[85], h[32], rlp[23];
    keccak256(guard_in, 64, guarded);

    c2[0] = 0xff;
    memcpy(c2 + 1, CREATEX, 20);
    memcpy(c2 + 21, guarded, 32);
    memcpy(c2 + 53, PROXY_INITCODE_HASH, 32);
    keccak256(c2, 85, h);

    rlp[0] = 0xd6;
    rlp[1] = 0x94;
    memcpy(rlp + 2, h + 12, 20);
    rlp[22] = 0x01;
    keccak256(rlp, 23, h);
    memcpy(addr_out, h + 12, 20);
}

// ── hex helpers ───────────────────────────────────────────────────────────────────────────────

static int unhex(const char *s, uint8_t *out, size_t want)
{
    if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) s += 2;
    if (strlen(s) != want * 2) return -1;
    for (size_t i = 0; i < want; i++) {
        unsigned v;
        if (sscanf(s + 2 * i, "%2x", &v) != 1) return -1;
        out[i] = (uint8_t)v;
    }
    return 0;
}

static void printhex(const uint8_t *b, size_t n)
{
    fputs("0x", stdout);
    for (size_t i = 0; i < n; i++) printf("%02x", b[i]);
}

// ── mining ────────────────────────────────────────────────────────────────────────────────────

typedef struct {
    uint8_t deployer[20];
    int prefix_bytes;
    int count;
    uint64_t seed;
    int thread_id;
    int thread_count;
} worker_args;

static pthread_mutex_t hits_lock = PTHREAD_MUTEX_INITIALIZER;
static uint8_t hit_salt[64][32];
static uint8_t hit_addr[64][20];
static int hits = 0;
static atomic_int stop_flag = 0;
static atomic_ullong tried = 0;

static void *worker(void *p)
{
    worker_args *a = (worker_args *)p;
    uint8_t guard_in[64];
    uint8_t addr[20];
    memset(guard_in, 0, sizeof(guard_in));
    memcpy(guard_in + 12, a->deployer, 20);  // uint256(uint160(deployer))
    memcpy(guard_in + 32, a->deployer, 20);  // salt[0..19]
    guard_in[32 + 20] = 0x00;                // salt[20] — redeploy-protection flag off

    // splitmix64 stream, written into salt[21..31] (88 bits of entropy). Threads walk the SAME
    // additive sequence but at disjoint offsets — thread i starts at i steps in and advances by
    // `threads` steps — so no two workers ever test the same candidate. (A per-thread stream that
    // merely starts one step apart makes every thread re-walk its neighbour's work, which divides
    // real throughput by the thread count without changing the reported rate.)
    const uint64_t GOLDEN = 0x9e3779b97f4a7c15ULL;
    uint64_t x = a->seed + GOLDEN * (uint64_t)a->thread_id;
    const uint64_t step = GOLDEN * (uint64_t)a->thread_count;
    uint64_t local = 0;

    while (!atomic_load_explicit(&stop_flag, memory_order_relaxed)) {
        for (int batch = 0; batch < 4096; batch++) {
            x += step;
            uint64_t z = x;
            z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
            z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
            z ^= z >> 31;
            // 88 bits: 64 from z, 24 from a rotation of it
            uint64_t y = (z << 17) | (z >> 47);
            uint8_t *e = guard_in + 32 + 21;
            memcpy(e, &z, 8);
            e[8] = (uint8_t)(y);
            e[9] = (uint8_t)(y >> 8);
            e[10] = (uint8_t)(y >> 16);

            derive_address(guard_in, addr);

            int ok = 1;
            for (int i = 0; i < a->prefix_bytes; i++)
                if (addr[i] != 0x00) {
                    ok = 0;
                    break;
                }
            if (ok) {
                pthread_mutex_lock(&hits_lock);
                if (hits < a->count) {
                    memcpy(hit_salt[hits], guard_in + 32, 32);
                    memcpy(hit_addr[hits], addr, 20);
                    hits++;
                    printf("  hit %d/%d  salt=", hits, a->count);
                    printhex(guard_in + 32, 32);
                    printf("  addr=");
                    printhex(addr, 20);
                    printf("\n");
                    fflush(stdout);
                    if (hits >= a->count) atomic_store(&stop_flag, 1);
                }
                pthread_mutex_unlock(&hits_lock);
            }
        }
        local += 4096;
        if (local >= (1u << 20)) {
            atomic_fetch_add(&tried, local);
            local = 0;
        }
    }
    atomic_fetch_add(&tried, local);
    return NULL;
}

int main(int argc, char **argv)
{
    uint8_t deployer[20];
    int have_deployer = 0;
    int prefix_bytes = 4;
    int count = 6;
    int threads = (int)sysconf(_SC_NPROCESSORS_ONLN);
    uint64_t seed = 0;
    const char *verify_salt = NULL;

    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--deployer") && i + 1 < argc) {
            if (unhex(argv[++i], deployer, 20) != 0) {
                fprintf(stderr, "--deployer must be a 20-byte hex address\n");
                return 2;
            }
            have_deployer = 1;
        } else if (!strcmp(argv[i], "--prefix-bytes") && i + 1 < argc) {
            prefix_bytes = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--count") && i + 1 < argc) {
            count = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--threads") && i + 1 < argc) {
            threads = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--seed") && i + 1 < argc) {
            seed = strtoull(argv[++i], NULL, 0);
        } else if (!strcmp(argv[i], "--verify") && i + 1 < argc) {
            verify_salt = argv[++i];
        } else {
            fprintf(stderr, "unknown or incomplete argument: %s\n", argv[i]);
            return 2;
        }
    }

    if (verify_salt) {
        uint8_t salt[32], guard_in[64], addr[20];
        if (unhex(verify_salt, salt, 32) != 0) {
            fprintf(stderr, "--verify must be a 32-byte hex salt\n");
            return 2;
        }
        memset(guard_in, 0, sizeof(guard_in));
        memcpy(guard_in + 12, salt, 20);  // the salt's own deployer field is the guard
        memcpy(guard_in + 32, salt, 32);
        derive_address(guard_in, addr);
        printf("salt=");
        printhex(salt, 32);
        printf("  deployer=");
        printhex(salt, 20);
        printf("  flag=0x%02x  addr=", salt[20]);
        printhex(addr, 20);
        printf("\n");
        return 0;
    }

    if (!have_deployer) {
        fprintf(stderr, "usage: %s --deployer 0x<address> [--prefix-bytes N] [--count N] "
                        "[--threads N] [--seed N]\n       %s --verify 0x<32-byte salt>\n",
            argv[0], argv[0]);
        return 2;
    }
    if (prefix_bytes < 1 || prefix_bytes > 19) {
        fprintf(stderr, "--prefix-bytes must be 1..19\n");
        return 2;
    }
    if (count < 1 || count > 64) {
        fprintf(stderr, "--count must be 1..64\n");
        return 2;
    }
    if (threads < 1) threads = 1;

    if (seed == 0) {
        FILE *f = fopen("/dev/urandom", "rb");
        if (!f || fread(&seed, sizeof(seed), 1, f) != 1) seed = (uint64_t)time(NULL) * 6364136223846793005ULL;
        if (f) fclose(f);
    }

    printf("deployer      "); printhex(deployer, 20); printf("\n");
    printf("prefix        %d zero byte(s) — expected ~2^%d candidates per hit\n", prefix_bytes,
        prefix_bytes * 8);
    printf("count         %d\nthreads       %d\nseed          0x%016" PRIx64 "\n\n", count, threads, seed);

    pthread_t *tid = calloc((size_t)threads, sizeof(pthread_t));
    worker_args *args = calloc((size_t)threads, sizeof(worker_args));
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    for (int i = 0; i < threads; i++) {
        memcpy(args[i].deployer, deployer, 20);
        args[i].prefix_bytes = prefix_bytes;
        args[i].count = count;
        args[i].seed = seed;
        args[i].thread_id = i;
        args[i].thread_count = threads;
        pthread_create(&tid[i], NULL, worker, &args[i]);
    }

    // progress reporter
    while (!atomic_load(&stop_flag)) {
        struct timespec ts = { 2, 0 };
        nanosleep(&ts, NULL);
        clock_gettime(CLOCK_MONOTONIC, &t1);
        double secs = (double)(t1.tv_sec - t0.tv_sec) + 1e-9 * (double)(t1.tv_nsec - t0.tv_nsec);
        unsigned long long n = atomic_load(&tried);
        if (secs > 0)
            fprintf(stderr, "\r  %.0f Mcand  %.1f Mcand/s  %d/%d found   ", (double)n / 1e6,
                (double)n / secs / 1e6, hits, count);
    }
    for (int i = 0; i < threads; i++) pthread_join(tid[i], NULL);

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double secs = (double)(t1.tv_sec - t0.tv_sec) + 1e-9 * (double)(t1.tv_nsec - t0.tv_nsec);
    unsigned long long n = atomic_load(&tried);
    fprintf(stderr, "\r%*s\r", 60, "");
    printf("\nmined %d salt(s) in %.1fs — %.0f Mcand, %.1f Mcand/s\n", hits, secs, (double)n / 1e6,
        (double)n / (secs > 0 ? secs : 1) / 1e6);

    printf("\n// paste into script/SepoliaSalts.sol\n");
    for (int i = 0; i < hits; i++) {
        printf("    bytes32 internal constant SALT_%d = ", i);
        printhex(hit_salt[i], 32);
        printf("; // => ");
        printhex(hit_addr[i], 20);
        printf("\n");
    }

    free(tid);
    free(args);
    return hits == count ? 0 : 1;
}
