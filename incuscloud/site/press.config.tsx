import { defineConfig } from "fumapress";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { metaSchema, pageSchema } from "fumapress/adapters/mdx/schema";
import { createDocsLayoutPage } from "fumapress/layouts/docs";
import { createRootLayout } from "fumapress/layouts/root";
import { takumiPlugin } from "fumapress/plugins/takumi";
import takumiWasm from "fumapress/plugins/takumi.wasm";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";
import { defineDocs } from "fumadocs-mdx/macro";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { TypeTable } from "fumadocs-ui/components/type-table";
import defaultMdxComponents, { createRelativeLink } from "fumadocs-ui/mdx";
import { Archive, ArrowRightLeft, Boxes, Building2, Cloud, Container, Flame, HardDrive, KeyRound, ListChecks, Network, Rocket, Scale, Server, Settings, ShieldCheck, Ship, Terminal } from "lucide-react";
import { Logo } from "./src/components/logo";
import { OgImage } from "./src/components/og-image";
import { Screenshot } from "./src/components/screenshot";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true,
    schema: pageSchema,
    lastModified: true,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// hyprr house style is dark-only: monochrome zinc, light is the only accent.
const RootLayout = createRootLayout({
  providerProps: { theme: { forcedTheme: "dark", defaultTheme: "dark" } },
});

const DocsPage = createDocsLayoutPage<typeof config.$context>({ treeRoot: "docs" });

const config = defineConfig({
  content: {
    docs: docs.toFumadocsSource({ baseDir: "docs" }),
  },
  loaderOptions: {
    plugins: [lucideIconsPlugin()],
  },
  site: {
    name: "IncusCloud",
    baseUrl: import.meta.env.DEV ? "http://localhost:3003" : "https://incuscloud.hyprr.space",
  },
  meta: {
    root() {
      return (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" rel="stylesheet" />
          <link rel="icon" href="/icon.svg" type="image/svg+xml" />
          <meta name="theme-color" content="#09090b" />
        </>
      );
    },
  },
  defaultLayoutProps() {
    return {
      nav: { title: <Logo />, url: "/" },
      themeSwitch: { enabled: false },
      githubUrl: "https://github.com/m41denx/incendio",
    };
  },
  renderRoot: (props) => <RootLayout {...props} />,
  renderPage: (props) => <DocsPage {...props} />,
}).adapters(
  fumadocsMdx({
    async getMdxComponents(page) {
      const source = await this.getLoader();

      return {
        ...defaultMdxComponents,
        Accordion,
        Accordions,
        Callout,
        Card,
        Cards,
        File,
        Files,
        Folder,
        Step,
        Steps,
        Tab,
        Tabs,
        TypeTable,
        Screenshot,
        // Icons the docs use in <Card icon={…}>.
        Archive,
        ArrowRightLeft,
        Boxes,
        Building2,
        Cloud,
        Container,
        Flame,
        HardDrive,
        KeyRound,
        ListChecks,
        Network,
        Rocket,
        Scale,
        Server,
        Settings,
        ShieldCheck,
        Ship,
        Terminal,
        a: createRelativeLink(source, page),
      };
    },
  }),
)
  // OG images through Takumi's WASM backend: the native addon can't be resolved from the bundled
  // server under Bun's isolated installs, and WASM behaves the same on every build machine.
  .plugins(
    takumiPlugin({
      options: { module: takumiWasm },
      generate(page) {
        return {
          node: <OgImage eyebrow="Docs" title={page.data.title} description={page.data.description} />,
        };
      },
    }),
  );

export default config;
