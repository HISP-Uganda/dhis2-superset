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
/* eslint-disable theme-colors/no-literal-colors */

/**
 * Public Page Layout Configuration
 *
 * This module provides configurable options for the public dashboard landing page.
 * All settings can be customized to match your organization's branding and layout preferences.
 */

export interface PublicPageNavbarConfig {
  /** Whether to show the top navigation bar */
  enabled: boolean;
  /** Height of the navbar in pixels */
  height: number;
  /** Background color (CSS color value) */
  backgroundColor: string;
  /** Box shadow (CSS box-shadow value) */
  boxShadow: string;
  /** Logo configuration */
  logo: {
    /** Whether to show the logo */
    enabled: boolean;
    /** Logo image source (URL or imported image) */
    src?: string;
    /** Optional dark mode logo source */
    darkSrc?: string;
    /** Alt text for the logo */
    alt: string;
    /** Logo height in pixels */
    height: number;
  };
  /** Title text configuration */
  title: {
    /** Whether to show the title */
    enabled: boolean;
    /** Title text content */
    text: string;
    /** Title font size (CSS font-size value) */
    fontSize: string;
    /** Title font weight */
    fontWeight: number;
    /** Title color (CSS color value) */
    color: string;
    /** Optional dark mode title color */
    darkColor?: string;
  };
  /** Login button configuration */
  loginButton: {
    /** Whether to show the login button */
    enabled: boolean;
    /** Button text */
    text: string;
    /** Button URL */
    url: string;
    /** Button type (primary, default, etc.) */
    type: 'primary' | 'default' | 'dashed' | 'link' | 'text';
  };
  /** Custom links to show in the navbar */
  customLinks: Array<{
    text: string;
    url: string;
    external?: boolean;
  }>;
}

export interface PublicPageSidebarConfig {
  /** Whether to show the sidebar */
  enabled: boolean;
  /** Width of the sidebar in pixels */
  width: number;
  /** Position of the sidebar */
  position: 'left' | 'right';
  /** Background color */
  backgroundColor: string;
  /** Sidebar text color */
  textColor?: string;
  /** Sidebar accent color */
  accentColor?: string;
  /** Border style */
  borderStyle: string;
  /** Title to display above dashboard list */
  title: string;
  /** Whether sidebar is collapsible on mobile */
  collapsibleOnMobile: boolean;
  /** Breakpoint for mobile collapse (in pixels) */
  mobileBreakpoint: number;
}

export interface PublicPageContentConfig {
  /** Background color of the content area */
  backgroundColor: string;
  /** Padding around the content */
  padding: string;
  /** Whether to show welcome message when no dashboard selected */
  showWelcomeMessage: boolean;
  /** Welcome message title */
  welcomeTitle: string;
  /** Welcome message description */
  welcomeDescription: string;
}

export interface PublicPageFooterConfig {
  /** Whether to show the footer */
  enabled: boolean;
  /** Footer height in pixels */
  height: number;
  /** Background color */
  backgroundColor: string;
  /** Footer text content */
  text: string;
  /** Footer text color */
  textColor: string;
  /** Links to show in footer */
  links: Array<{
    text: string;
    url: string;
    external?: boolean;
  }>;
}

export interface PublicPageLayoutConfig {
  navbar: PublicPageNavbarConfig;
  sidebar: PublicPageSidebarConfig;
  content: PublicPageContentConfig;
  footer: PublicPageFooterConfig;
  /** Custom CSS to inject */
  customCss?: string;
}

/**
 * Default configuration for the public landing page
 * Override these values in your superset_config.py or through the API
 */
export const DEFAULT_PUBLIC_PAGE_CONFIG: PublicPageLayoutConfig = {
  navbar: {
    enabled: true,
    height: 52,
    backgroundColor: '#0D3B66',
    boxShadow: '0 1px 3px rgba(13,59,102,0.08)',
    logo: {
      enabled: true,
      alt: 'Organization Logo',
      height: 36,
    },
    title: {
      enabled: true,
      text: 'Uganda Malaria Analytics Portal',
      fontSize: '16px',
      fontWeight: 700,
      color: '#ffffff',
      darkColor: '#e6edf3',
    },
    loginButton: {
      enabled: true,
      text: 'Sign In',
      url: '/login/',
      type: 'primary',
    },
    customLinks: [],
  },
  sidebar: {
    enabled: true,
    width: 260,
    position: 'left',
    backgroundColor: '#F5F7FA',
    textColor: '#1A1F2C',
    accentColor: '#1976D2',
    borderStyle: '1px solid #E5EAF0',
    title: 'Dashboards',
    collapsibleOnMobile: true,
    mobileBreakpoint: 768,
  },
  content: {
    backgroundColor: '#F5F7FA',
    padding: '0',
    showWelcomeMessage: true,
    welcomeTitle: 'Uganda Malaria Analytics Portal',
    welcomeDescription:
      'Explore curated public dashboards, recent highlights, and staged analytics prepared for programme review.',
  },
  footer: {
    enabled: true,
    height: 48,
    backgroundColor: '#0D3B66',
    text: '© Uganda Malaria Analytics Portal · Ministry of Health',
    textColor: 'rgba(255, 255, 255, 0.7)',
    links: [
      { text: 'Data Sources', url: '#' },
      { text: 'Methodology', url: '#' },
      { text: 'Contact', url: '#' },
    ],
  },
};

/**
 * Merges user configuration with defaults
 */
export function mergeConfig(
  userConfig: Partial<PublicPageLayoutConfig>,
): PublicPageLayoutConfig {
  return {
    navbar: {
      ...DEFAULT_PUBLIC_PAGE_CONFIG.navbar,
      ...userConfig.navbar,
      logo: {
        ...DEFAULT_PUBLIC_PAGE_CONFIG.navbar.logo,
        ...userConfig.navbar?.logo,
      },
      title: {
        ...DEFAULT_PUBLIC_PAGE_CONFIG.navbar.title,
        ...userConfig.navbar?.title,
      },
      loginButton: {
        ...DEFAULT_PUBLIC_PAGE_CONFIG.navbar.loginButton,
        ...userConfig.navbar?.loginButton,
      },
    },
    sidebar: {
      ...DEFAULT_PUBLIC_PAGE_CONFIG.sidebar,
      ...userConfig.sidebar,
    },
    content: {
      ...DEFAULT_PUBLIC_PAGE_CONFIG.content,
      ...userConfig.content,
    },
    footer: {
      ...DEFAULT_PUBLIC_PAGE_CONFIG.footer,
      ...userConfig.footer,
    },
    customCss: userConfig.customCss,
  };
}
