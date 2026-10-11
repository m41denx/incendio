// Runs a FakeIncus in its own process (memory measurements must not count it).
// Prints `<port> <fingerprint>` on stdout once listening.
import { FakeIncus } from "../clusters/fake-incus.ts";

const fake = await new FakeIncus().start();
console.log(`${fake.port} ${fake.fingerprint}`);
