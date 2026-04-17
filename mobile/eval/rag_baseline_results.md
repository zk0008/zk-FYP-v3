# RAG Baseline Results — Current Pipeline (Pre-Improvement)

Responses recorded using the existing web app before any RAG changes.
All AI Response, Correct?, Source Cited?, and Notes columns to be filled in during testing.

| # | Question | AI Response | Correct? | Source Cited? | Notes |
|---|---|---|---|---|---|
| 1 | What are the three bases of authentication? | What you know, what you possess, what you are | yes | no | no |
| 2 | What is the difference between weak and strong authentication? | Weak: single factor, password-based, unilateral, providing a secret, vulnerable to security risk. Strong: multiple factors, mutual authentication, challenge-response | yes | no | no |
| 3 | What are the three ways passwords can be stored, from worst to best? | Plaintext (bad), encrypted (fair), hashed (good) | yes | no | no |
| 4 | What is a one-way function? | Easy to compute f(x) given x, but computationally infeasible to find x given f(x) | yes | no | no |
| 5 | What are the two key properties of a hash function? | Pre-image resistant and collision resistant | yes | no | no |
| 6 | Name four important hash functions mentioned in the lecture. | SHA256, SHA512, KECCAK (for crypto), ARGON2 | yes | no | no |
| 7 | Where are password hashes stored in Unix/Linux systems? | older systems /etc/passwd, but modern systems use /etc/shadow | yes | no | no |
| 8 | Where are passwords stored in Windows systems? | Security Accounts Manager (SAM) file at %windir%\system32\config\SAM  | yes | no | no |
| 9 | What is a salt and what is its primary purpose? | Random string of data added as additional input to a password before hash function; primary purpose is to defend against dictionary attacks and increase complexity | yes | no | no |
| 10 | What is an offline guessing attack? | Attacker obtains hashed passwords and attempts to guess the original passwords without interacting with the system where the passwords are stored | yes | no | no |
| 11 | What is a dictionary attack and how does it work? | Exploits human-chosen passwords by trying large number of possiblities; attacker guesses common passwords, computes their hashes, and compare matching hashes in the password file | yes | no | no |
| 12 | What is a brute force attack and what is the main defence against it? | Trying all possible passwords until the correct one is found; defence is to increase the password space (longer passwords, more symbol variety), implementing account lockout policies and using strong hash algorithms | yes | no | no |
| 13 | What is a pre-computed hash table attack? | Precompute a table of passwords and their hashes, then look up stolen hashes against the table | yes | no | no |
| 14 | How does salting defend against pre-computed hash table attacks? | Each password adds a unique, random string (salt) to each password before hashing | partial | no | vague answer |
| 15 | Why should passwords be hashed rather than encrypted? | Hashing is one-way and irreversible; encryption is two-way and the original password can be retrieved with the key | yes | no | no |
| 16 | What are three alternative forms of passwords beyond standard text passwords? | Passphrases, visual drawing patterns, picture passwords | yes | no | no |
| 17 | What are three problems with forcing users to use complex, frequently changed passwords? | Difficulty memorising complex passwords, difficulty with frequent changes, tendency to reuse passwords | yes | no | no |
| 18 | What are the six password policy measures described in the lecture? | Set a password, change default passwords, avoid guessable passwords, password ageing, limit login attempts, inform user of login attempts | yes | no | no |
| 19 | What is the difference between a false positive and false negative in biometric authentication? | False positive: wrong user accepted (security problem). False negative: legitimate user rejected (inconvenience, inefficiency) | yes | no | no |
| 20 | What are the three options for protecting a password file? | Cryptographic protection, access control by OS, combination of both with measures to slow dictionary attacks | yes | no | no |

@ai give me a short summary for the following question 
