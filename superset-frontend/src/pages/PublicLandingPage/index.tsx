/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { useState } from 'react';
import { styled, t } from '@superset-ui/core';
import { Button, Loading } from '@superset-ui/core/components';
import logoImage from 'src/assets/images/loog.jpg';
import DashboardContentArea from 'src/features/home/DashboardContentArea';
import ConfigurableSidebar, { type Dashboard } from './ConfigurableSidebar';
import { usePublicPageConfig } from './usePublicPageConfig';
import { PublicPageLayoutConfig } from './config';

// Dynamic styled components that accept configuration
const PageWrapper = styled.div<{ $customCss?: string }>`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: white;
  z-index: 9999;
  overflow-y: auto;
  ${({ $customCss }) => $customCss || ''}
`;

const PublicNavbar = styled.div<{
  $height: number;
  $backgroundColor: string;
  $boxShadow: string;
}>`
  background: ${({ $backgroundColor }) => $backgroundColor};
  box-shadow: ${({ $boxShadow }) => $boxShadow};
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 101;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: ${({ $height }) => $height}px;
  padding: 0 24px;
`;

const LogoSection = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const LogoImage = styled.img<{ $height: number }>`
  height: ${({ $height }) => $height}px;
  width: auto;
`;

const LogoText = styled.div<{
  $fontSize: string;
  $fontWeight: number;
  $color: string;
}>`
  font-size: ${({ $fontSize }) => $fontSize};
  font-weight: ${({ $fontWeight }) => $fontWeight};
  color: ${({ $color }) => $color};
`;

const NavLinks = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

const NavLink = styled.a`
  ${({ theme }) => `
    color: ${theme.colorText};
    text-decoration: none;
    font-size: 14px;
    &:hover {
      color: ${theme.colorPrimary};
    }
  `}
`;

const ContentWrapper = styled.div<{
  $navbarHeight: number;
  $sidebarWidth: number;
  $sidebarPosition: string;
  $sidebarEnabled: boolean;
  $backgroundColor: string;
  $padding: string;
  $mobileBreakpoint: number;
}>`
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - ${({ $navbarHeight }) => $navbarHeight}px);
  position: relative;
  padding-top: ${({ $navbarHeight }) => $navbarHeight}px;
  background: ${({ $backgroundColor }) => $backgroundColor};

  ${({ $sidebarEnabled, $sidebarWidth, $sidebarPosition }) =>
    $sidebarEnabled
      ? $sidebarPosition === 'left'
        ? `
          margin-left: ${$sidebarWidth}px;
          width: calc(100% - ${$sidebarWidth}px);
        `
        : `
          margin-right: ${$sidebarWidth}px;
          width: calc(100% - ${$sidebarWidth}px);
        `
      : 'width: 100%;'}

  @media (max-width: ${({ $mobileBreakpoint }) => $mobileBreakpoint}px) {
    margin-left: 0;
    margin-right: 0;
    width: 100%;
  }
`;

const WelcomeContainer = styled.div`
  ${({ theme }) => `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 400px;
    padding: ${theme.sizeUnit * 8}px;
    text-align: center;
  `}
`;

const WelcomeTitle = styled.h1`
  ${({ theme }) => `
    font-size: 28px;
    font-weight: 600;
    color: ${theme.colorText};
    margin-bottom: ${theme.sizeUnit * 2}px;
  `}
`;

const WelcomeDescription = styled.p`
  ${({ theme }) => `
    font-size: 16px;
    color: ${theme.colorTextSecondary};
    max-width: 500px;
  `}
`;

const Footer = styled.div<{
  $height: number;
  $backgroundColor: string;
  $textColor: string;
}>`
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: ${({ $height }) => $height}px;
  background: ${({ $backgroundColor }) => $backgroundColor};
  color: ${({ $textColor }) => $textColor};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  font-size: 14px;
  z-index: 100;
`;

const FooterLink = styled.a<{ $textColor: string }>`
  color: ${({ $textColor }) => $textColor};
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

const LoadingWrapper = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100%;
`;

interface PublicLandingPageProps {
  /** Optional override configuration */
  overrideConfig?: Partial<PublicPageLayoutConfig>;
}

export default function PublicLandingPage({
  overrideConfig,
}: PublicLandingPageProps = {}) {
  const { config: baseConfig, loading: configLoading } = usePublicPageConfig();
  const [selectedDashboard, setSelectedDashboard] = useState<
    Dashboard | undefined
  >(undefined);

  // Merge override config if provided
  const config = overrideConfig
    ? { ...baseConfig, ...overrideConfig }
    : baseConfig;

  const handleLogin = () => {
    window.location.href = config.navbar.loginButton.url;
  };

  const handleDashboardSelect = (dashboard: Dashboard) => {
    setSelectedDashboard(dashboard);
  };

  if (configLoading) {
    return (
      <LoadingWrapper>
        <Loading />
      </LoadingWrapper>
    );
  }

  const { navbar, sidebar, content, footer } = config;

  return (
    <PageWrapper $customCss={config.customCss}>
      {navbar.enabled && (
        <PublicNavbar
          $height={navbar.height}
          $backgroundColor={navbar.backgroundColor}
          $boxShadow={navbar.boxShadow}
        >
          <LogoSection>
            {navbar.logo.enabled && (
              <LogoImage
                src={navbar.logo.src || logoImage}
                alt={navbar.logo.alt}
                $height={navbar.logo.height}
              />
            )}
            {navbar.title.enabled && (
              <LogoText
                $fontSize={navbar.title.fontSize}
                $fontWeight={navbar.title.fontWeight}
                $color={navbar.title.color}
              >
                {navbar.title.text}
              </LogoText>
            )}
          </LogoSection>

          <NavLinks>
            {navbar.customLinks.map((link, index) => (
              <NavLink
                key={index}
                href={link.url}
                target={link.external ? '_blank' : undefined}
                rel={link.external ? 'noopener noreferrer' : undefined}
              >
                {link.text}
              </NavLink>
            ))}
            {navbar.loginButton.enabled && (
              <Button type={navbar.loginButton.type} onClick={handleLogin}>
                {t(navbar.loginButton.text)}
              </Button>
            )}
          </NavLinks>
        </PublicNavbar>
      )}

      <ContentWrapper
        $navbarHeight={navbar.enabled ? navbar.height : 0}
        $sidebarWidth={sidebar.width}
        $sidebarPosition={sidebar.position}
        $sidebarEnabled={sidebar.enabled}
        $backgroundColor={content.backgroundColor}
        $padding={content.padding}
        $mobileBreakpoint={sidebar.mobileBreakpoint}
      >
        <ConfigurableSidebar
          config={sidebar}
          navbarHeight={navbar.enabled ? navbar.height : 0}
          selectedKey={selectedDashboard?.id.toString()}
          onSelect={handleDashboardSelect}
        />
        {selectedDashboard ? (
          <DashboardContentArea
            selectedDashboard={selectedDashboard}
            isPublic
            showEmbeddingManager={false}
          />
        ) : (
          content.showWelcomeMessage && (
            <WelcomeContainer>
              <WelcomeTitle>{t(content.welcomeTitle)}</WelcomeTitle>
              <WelcomeDescription>
                {t(content.welcomeDescription)}
              </WelcomeDescription>
            </WelcomeContainer>
          )
        )}
      </ContentWrapper>

      {footer.enabled && (
        <Footer
          $height={footer.height}
          $backgroundColor={footer.backgroundColor}
          $textColor={footer.textColor}
        >
          {footer.text && <span>{footer.text}</span>}
          {footer.links.map((link, index) => (
            <FooterLink
              key={index}
              href={link.url}
              $textColor={footer.textColor}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
            >
              {link.text}
            </FooterLink>
          ))}
        </Footer>
      )}
    </PageWrapper>
  );
}

// Export config types for external use
export type { PublicPageLayoutConfig } from './config';
export { DEFAULT_PUBLIC_PAGE_CONFIG, mergeConfig } from './config';
