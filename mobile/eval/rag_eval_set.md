# RAG Evaluation Set — Authentication & Passwords

Questions based on NTU lecture slides on Authentication & Passwords.
Expected answers and sources to be filled in after document upload and testing.

| # | Question | Expected answer (key facts) | Source |
|---|---|---|---|
| 1 | What are the three bases of authentication? | What you know, what you possess, what you are | Slide 2 |
| 2 | What is the difference between weak and strong authentication? | Weak: password-based, unilateral, gives up the secret. Strong: mutual authentication, challenge-response, zero knowledge proofs | Slide 3 |
| 3 | What are the three ways passwords can be stored, from worst to best? | Plaintext (bad), encrypted (fair), hashed (good) | Slide 4 |
| 4 | What is a one-way function? | Easy to compute f(x) given x, but computationally infeasible to find x given f(x) | Slide 5 |
| 5 | What are the two key properties of a hash function? | Pre-image resistant and collision resistant | Slide 6 |
| 6 | Name any four important hash functions mentioned in the lecture. | SHA256, SHA512, KECCAK (for crypto), ARGON2, bcrypt (for password hashing) | Slide 6 |
| 7 | Where are password hashes stored in Unix/Linux systems? | Originally /etc/passwd, but modern systems use /etc/shadow | Slide 8 |
| 8 | Where are passwords stored in Windows systems? | Security Accounts Manager (SAM) file at %windir%\system32\config\SAM | Slide 8 |
| 9 | What is a salt and what is its primary purpose? | Random data added as additional input to a hash function; primary purpose is to defend against dictionary attacks | Slide 4 |
| 10 | What is an offline guessing attack? | Attacker obtains hashed passwords and attempts to guess the original passwords offline | Slide 11 |
| 11 | What is a dictionary attack and how does it work? | Exploits weak human-chosen passwords; attacker guesses common passwords, computes their hashes, and looks for matching hashes in the password file | Slide 18 |
| 12 | What is a brute force attack and what is the main defence against it? | Enumerates all possible passwords and their hashes; defence is to increase the password space (longer passwords, more symbol variety) | Slide 14 |
| 13 | What is a pre-computed hash table attack? | Precompute a table of passwords and their hashes, then look up stolen hashes against the table | Slide 19 |
| 14 | How does salting defend against pre-computed hash table attacks? | Each password has a unique salt, so attacker must compute 2^n hashes per password rather than reusing one table | Slide 20 |
| 15 | Why should passwords be hashed rather than encrypted? | Hashing is one-way and irreversible; encryption is two-way and the original password can be retrieved with the key | Slides 21-22 |
| 16 | What are any three alternative forms of passwords beyond standard text passwords? | Passphrases, visual drawing patterns, picture passwords, one-time passwords | Slide 32 |
| 17 | What are three problems with forcing users to use complex, frequently changed passwords? | Difficulty memorising complex passwords, difficulty with frequent changes, users find ways to reuse favourite passwords | Slide 29 |
| 18 | What are the six password policy measures described in the lecture? | Set a password, change default passwords, avoid guessable passwords, password ageing, limit login attempts, inform user of last login | Slides 30-31 |
| 19 | What is the difference between a false positive and false negative in biometric authentication? | False positive: wrong user accepted (security problem). False negative: legitimate user rejected (embarrassment, inefficiency) | Slide 35 |
| 20 | What are the three options for protecting a password file? | Cryptographic protection, access control by OS, combination of both with measures to slow dictionary attacks | Slide 33 |
