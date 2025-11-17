/**
 * User input prompts
 *
 * Utilities for reading user input from stdin
 */

import { createInterface as createReadlineInterface, Interface } from 'readline';

/**
 * Tracks readline interfaces that were closed intentionally so CTRL+D handlers
 * don't treat them as cancellations.
 */
const gracefullyClosed = new WeakSet<Interface>();

/**
 * Handles prompt cancellation (Ctrl+C / Ctrl+D) consistently.
 */
function cancelInitialization(): never {
  console.log('\nInitialization cancelled.');
  process.exit(130);
}

/**
 * Creates a readline interface with common signal handling.
 *
 * @returns Configured readline.Interface instance
 */
export function createInterface(): Interface {
  const rl = createReadlineInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const handleInterrupt = (): void => {
    if (gracefullyClosed.has(rl)) {
      return;
    }
    gracefullyClosed.add(rl);
    rl.close();
    cancelInitialization();
  };

  rl.on('SIGINT', handleInterrupt);
  rl.on('close', () => {
    if (gracefullyClosed.has(rl)) {
      return;
    }
    cancelInitialization();
  });

  return rl;
}

/**
 * Closes a readline interface created by createInterface()
 *
 * @param rl - readline interface to close
 */
export function closeInterface(rl: Interface): void {
  gracefullyClosed.add(rl);
  rl.removeAllListeners('SIGINT');
  rl.removeAllListeners('close');
  rl.close();
}

/**
 * Prompts user for confirmation by typing an expected value
 *
 * @param message - Message to display to user
 * @param expectedValue - The exact value user must type to confirm
 * @returns true if user input matches expectedValue, false otherwise
 */
export async function promptConfirmation(message: string, expectedValue: string): Promise<boolean> {
  const answer = await question(message);
  return answer.trim() === expectedValue;
}

/**
 * Prompts user for yes/no confirmation
 *
 * @param message - Message to display to user
 * @returns true if user types 'y' or 'yes' (case-insensitive), false otherwise
 */
export async function promptYesNo(message: string): Promise<boolean> {
  const answer = await question(`${message} (y/n): `);
  const trimmedAnswer = answer.trim().toLowerCase();
  return trimmedAnswer === 'y' || trimmedAnswer === 'yes';
}

/**
 * Prompts user for a string input
 *
 * @param prompt - The prompt to display
 * @returns The user's input (trimmed)
 */
export async function question(prompt: string): Promise<string> {
  const rl = createInterface();

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      closeInterface(rl);
      resolve(answer.trim());
    });
  });
}

/**
 * Prompts user for a string input with a default value
 *
 * @param prompt - The prompt to display (without brackets)
 * @param defaultValue - The default value if user presses Enter
 * @returns The user's input or default value (trimmed)
 */
export async function questionWithDefault(prompt: string, defaultValue: string): Promise<string> {
  const answer = await question(`${prompt} [${defaultValue}]: `);
  return answer === '' ? defaultValue : answer;
}

/**
 * Prompts user for confirmation with custom yes/no prompt
 *
 * @param prompt - The prompt to display
 * @param defaultValue - Default value if user presses Enter
 * @returns true if user types 'y' or 'yes', false if 'n' or 'no' (case-insensitive)
 */
export async function confirm(prompt: string, defaultValue: boolean = false): Promise<boolean> {
  const defaultStr = defaultValue ? 'Y/n' : 'y/N';

  while (true) {
    const answer = await question(`${prompt} (${defaultStr}): `);

    if (answer === '') {
      return defaultValue;
    }

    const lower = answer.toLowerCase();
    if (lower === 'y' || lower === 'yes') {
      return true;
    }
    if (lower === 'n' || lower === 'no') {
      return false;
    }

    console.log('Please enter y/yes or n/no.');
  }
}
