import type { FC } from "react";
import Navigation from "components/Navigation";
import { Application, SkipLink } from "@canonical/react-components";
import Events from "./Events";
import App from "./App";
import ErrorBoundary from "components/ErrorBoundary";
import ErrorPage from "components/ErrorPage";
import StatusBar from "components/StatusBar";
import AppProviders from "context/appProviders";
import MinimalConsole from "pages/instances/MinimalConsole";
import { useIsMinimalConsole } from "util/minimalConsole";

const RootLayout: FC = () => {
  const isMinimalConsole = useIsMinimalConsole();

  if (isMinimalConsole) {
    return (
      <ErrorBoundary fallback={ErrorPage}>
        <MinimalConsole />
        <Events />
      </ErrorBoundary>
    );
  }

  return (
    <Application id="l-application">
      <SkipLink mainId="main-content" />
      <Navigation />
      <ErrorBoundary fallback={ErrorPage}>
        <App />
        <Events />
        <StatusBar />
      </ErrorBoundary>
    </Application>
  );
};

const Root: FC = () => {
  return (
    <ErrorBoundary fallback={ErrorPage}>
      <AppProviders>
        <RootLayout />
      </AppProviders>
    </ErrorBoundary>
  );
};

export default Root;
