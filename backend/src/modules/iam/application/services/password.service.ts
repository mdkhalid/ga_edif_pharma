import { Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

import { AppConfigService } from '../../../../config/app-config.service';
import type { Password } from '../../domain/value-objects/password.vo';

/**
 * Argon2id password hashing.
 *
 * ## Why argon2id and not bcrypt or PBKDF2
 *
 * Argon2id won the Password Hashing Competition and is the current OWASP first
 * choice. The distinction that matters here is *memory* hardness:
 *
 *   - PBKDF2 is CPU-hard only. A GPU or an ASIC computes billions of iterations
 *     per second, so the attacker's advantage over the defender is enormous.
 *   - bcrypt is memory-hard-ish but capped at 72 bytes of input (longer
 *     passwords are silently truncated) and its 4 KB working set fits in L2
 *     cache, which is exactly what GPU cracking exploits.
 *   - Argon2id has a configurable working set. At 19 MiB per hash, an attacker
 *     cannot run more parallel attempts than they have memory for — which is the
 *     property that makes GPU and ASIC attacks expensive rather than merely
 *     inconvenient.
 *
 * The `id` variant is hybrid: the first pass is data-independent (resisting
 * side-channel attacks on shared hardware), later passes are data-dependent
 * (resisting time-memory trade-off attacks). Argon2i alone is weaker against the
 * latter; Argon2d alone leaks through cache timing. `id` is the recommended
 * default and there is no reason to deviate.
 *
 * ## Why the parameters live in configuration
 *
 * The cost factors are a security/throughput trade-off that changes with the
 * hardware. 19 MiB / t=2 is OWASP's minimum recommendation and is appropriate
 * for a general-purpose API pod; a dedicated auth service with more memory could
 * raise it. Keeping it in configuration means raising it after a hardware
 * upgrade is an env change, not a code change.
 *
 * Raising them invalidates nothing: argon2 embeds its parameters in the encoded
 * hash, so existing hashes keep verifying and new ones use the new cost.
 */

export interface PasswordHashOptions {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/** Prefix of an argon2id encoded hash, e.g. `$argon2id$v=19$m=19456,t=2,p=1$…`. */
const ARGON2ID_PREFIX = '$argon2id$';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private readonly options: PasswordHashOptions;

  /**
   * A hash of a fixed, never-valid password.
   *
   * Used to equalise the cost of a sign-in attempt for a non-existent account.
   * Without it, "user not found" returns in microseconds while "wrong password"
   * takes ~50 ms — a timing oracle that lets an attacker enumerate valid
   * accounts before ever guessing a password. See `verifyDummy`.
   */
  private dummyHash: string | null = null;

  constructor(@Inject(AppConfigService) config: AppConfigService) {
    this.options = {
      memoryCost: config.argon2.memoryCost,
      timeCost: config.argon2.timeCost,
      parallelism: config.argon2.parallelism,
    };
  }

  /** Hashes a validated password. Never logs or returns the plaintext. */
  async hash(password: Password): Promise<string> {
    return argon2.hash(password.reveal(), {
      type: argon2.argon2id,
      memoryCost: this.options.memoryCost,
      timeCost: this.options.timeCost,
      parallelism: this.options.parallelism,
      // The salt is generated internally from the CSPRNG at the correct length.
      // Passing one explicitly is a way to introduce a fixed salt by accident.
    });
  }

  /**
   * Verifies a password against a stored hash.
   *
   * Returns `false` rather than throwing on a malformed hash: a corrupt row
   * should deny access, not produce a 500 that tells the caller the row exists
   * and is corrupt.
   */
  async verify(storedHash: string, candidate: string): Promise<boolean> {
    if (storedHash === '' || !storedHash.startsWith(ARGON2ID_PREFIX)) {
      this.logger.error(
        'A stored password hash is malformed or uses a legacy algorithm. ' +
          'Denying the sign-in attempt.',
      );
      return false;
    }

    try {
      return await argon2.verify(storedHash, candidate);
    } catch {
      // argon2 throws on a malformed encoded hash. Treat as a failed verification.
      return false;
    }
  }

  /**
   * Burns the same CPU time as a real verification, and always fails.
   *
   * Called when the account does not exist, so that the response time of
   * "unknown account" matches "wrong password". Account enumeration via timing
   * is cheap to exploit and trivially avoidable, so there is no reason to leave
   * it open.
   */
  async verifyDummy(candidate: string): Promise<false> {
    this.dummyHash ??= await argon2.hash('medichain-timing-equaliser-never-a-valid-password', {
      type: argon2.argon2id,
      memoryCost: this.options.memoryCost,
      timeCost: this.options.timeCost,
      parallelism: this.options.parallelism,
    });

    await this.verify(this.dummyHash, candidate).catch(() => false);
    return false;
  }

  /**
   * Reports whether a stored hash should be upgraded.
   *
   * Argon2 encodes its own parameters, so this is a direct comparison rather
   * than a stored "version" column. Called after a successful sign-in — the one
   * moment the plaintext is available — so the cost of rehashing is paid once
   * per user rather than on every request.
   */
  needsRehash(storedHash: string): boolean {
    try {
      // `argon2.needsRehash` compares the encoded parameters against the given
      // options and returns true when the stored hash is weaker.
      return argon2.needsRehash(storedHash, {
        memoryCost: this.options.memoryCost,
        timeCost: this.options.timeCost,
        parallelism: this.options.parallelism,
      });
    } catch {
      return true;
    }
  }
}
