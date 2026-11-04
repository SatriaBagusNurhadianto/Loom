// Installs the full official TeX bundle and TexLab without admin access or shell-profile edits.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, rename, rm, chmod, cp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, delimiter, isAbsolute } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error(
    'This setup supports Linux x86_64. Install TeX Live and TexLab for your platform.',
  );
}
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const work = await mkdtemp(join(homedir(), '.loom-latex-setup-'));
async function asset(repository, tag, name) {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/${tag}`);
  if (!response.ok) throw new Error(`Cannot read official release: ${response.status}`);
  const release = await response.json();
  const result = release.assets.find((item) => item.name === name);
  if (!result?.digest?.startsWith('sha256:')) throw new Error(`No verified release asset: ${name}`);
  return result;
}
async function archive(item, local) {
  const path = local ?? join(work, item.name);
  if (!local) {
    console.log(`Downloading ${item.name} (${Math.ceil(item.size / 1024 / 1024)} MiB)…`);
    const response = await fetch(item.browser_download_url);
    if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
    await pipeline(response.body, createWriteStream(path, { flags: 'wx' }));
  }
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  if (`sha256:${hash.digest('hex')}` !== item.digest) throw new Error('Release checksum mismatch.');
  console.log(`Verified ${item.name}`);
  return path;
}
try {
  const tex = join(homedir(), '.TinyTeX');
  if (!(await exists(tex))) {
    const release = await asset(
      'rstudio/tinytex-releases',
      'tags/daily',
      'TinyTeX-2-linux-x86_64.tar.xz',
    );
    const path = await archive(release, process.env.LOOM_TEX_ARCHIVE);
    const staging = join(work, 'tex');
    await mkdir(staging);
    execFileSync('tar', ['-xJf', path, '-C', staging], { stdio: 'inherit' });
    // Never delete or replace an existing TeX installation.
    if (await exists(tex))
      throw new Error('A TeX installation appeared during setup; it was preserved.');
    await rename(join(staging, '.TinyTeX'), tex);
    console.log(`Installed full TeX Live at ${tex}`);
  } else console.log(`Preserving existing TeX installation at ${tex}`);
  const bin = join(homedir(), '.local/share/loom/bin');
  await mkdir(bin, { recursive: true });
  if (!(await exists(join(bin, 'texlab')))) {
    const release = await asset('latex-lsp/texlab', 'latest', 'texlab-x86_64-linux.tar.gz');
    const path = await archive(release);
    const staging = join(work, 'texlab');
    await mkdir(staging);
    execFileSync('tar', ['-xzf', path, '-C', staging], { stdio: 'inherit' });
    await chmod(join(staging, 'texlab'), 0o755);
    await rename(join(staging, 'texlab'), join(bin, 'texlab'));
  }
  const lib = join(homedir(), '.local/share/loom/lib');
  const environment = {
    ...process.env,
    PATH: [join(tex, 'bin/x86_64-linux'), ...(process.env.PATH ?? '').split(delimiter)]
      .filter(isAbsolute)
      .join(delimiter),
    LD_LIBRARY_PATH: [lib, ...(process.env.LD_LIBRARY_PATH ?? '').split(delimiter)]
      .filter(isAbsolute)
      .join(delimiter),
  };
  try {
    execFileSync(join(tex, 'bin/x86_64-linux/biber'), ['--version'], {
      env: environment,
      stdio: 'pipe',
    });
  } catch (error) {
    if (!String(error.stderr).includes('libcrypt.so.1')) throw error;
    // Arch's signed compatibility package can be unpacked locally without root.
    const keyring = '/etc/pacman.d/gnupg/pubring.gpg';
    if (!(await exists(keyring)))
      throw new Error(
        'Biber needs libcrypt.so.1. Install your distribution’s libxcrypt compatibility package.',
      );
    const response = await fetch(
      'https://archlinux.org/packages/core/x86_64/libxcrypt-compat/json/',
    );
    if (!response.ok) throw new Error('Cannot discover the Arch compatibility package.');
    const metadata = await response.json();
    if (!/^libxcrypt-compat-[a-zA-Z0-9.+_-]+\.pkg\.tar\.zst$/.test(metadata.filename))
      throw new Error('Unexpected compatibility package name.');
    const packagePath = join(work, metadata.filename);
    for (const suffix of ['', '.sig']) {
      const packageResponse = await fetch(
        `https://geo.mirror.pkgbuild.com/core/os/x86_64/${metadata.filename}${suffix}`,
      );
      if (!packageResponse.ok || !packageResponse.body)
        throw new Error('Cannot download the compatibility package.');
      await pipeline(
        packageResponse.body,
        createWriteStream(packagePath + suffix, { flags: 'wx' }),
      );
    }
    execFileSync('gpgv', ['--keyring', keyring, packagePath + '.sig', packagePath], {
      stdio: 'inherit',
    });
    const staging = join(work, 'compat');
    await mkdir(staging);
    execFileSync('tar', [
      '-xf',
      packagePath,
      '-C',
      staging,
      'usr/lib/libcrypt.so.1',
      'usr/lib/libcrypt.so.1.1.0',
    ]);
    await mkdir(lib, { recursive: true });
    for (const name of ['libcrypt.so.1.1.0', 'libcrypt.so.1'])
      await cp(join(staging, 'usr/lib', name), join(lib, name), {
        force: false,
        errorOnExist: true,
        verbatimSymlinks: true,
      });
  }
  for (const tool of ['latexmk', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber', 'synctex']) {
    execFileSync(
      join(tex, 'bin/x86_64-linux', tool),
      [tool === 'latexmk' ? '-v' : tool === 'synctex' ? 'help' : '--version'],
      { stdio: 'inherit', env: environment },
    );
  }
  execFileSync(join(bin, 'texlab'), ['--version'], { stdio: 'inherit' });
  console.log('PDF tools are ready. Loom discovers these paths automatically.');
} finally {
  await rm(work, { recursive: true, force: true });
}
