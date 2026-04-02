/* eslint-disable no-console */
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
const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

const { ModuleFederationPlugin } = webpack.container;
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const SpeedMeasurePlugin = require('speed-measure-webpack-plugin');
const {
  WebpackManifestPlugin,
  getCompilerHooks,
} = require('webpack-manifest-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const parsedArgs = require('yargs').argv;
const Visualizer = require('webpack-visualizer-plugin2');
const getProxyConfig = require('./webpack.proxy-config');
const packageConfig = require('./package');

// input dir
const APP_DIR = path.resolve(__dirname, './');
// output dir
const BUILD_DIR = path.resolve(__dirname, '../superset/static/assets');
const ROOT_DIR = path.resolve(__dirname, '..');
// Public path for extracted css src:urls. All assets are compiled into the same
// folder. This forces the src:url in the extracted css to only contain the filename
// and will therefore be relative to the .css file itself and not have to worry about
// any url prefix.
const MINI_CSS_EXTRACT_PUBLICPATH = './';

const {
  mode = 'development',
  devserverPort: cliPort,
  devserverHost: cliHost,
  measure = false,
  nameChunks = false,
} = parsedArgs;

// Precedence: CLI args > env vars > defaults
const devserverPort = cliPort || process.env.WEBPACK_DEVSERVER_PORT || 9000;
const devserverHost =
  cliHost || process.env.WEBPACK_DEVSERVER_HOST || '127.0.0.1';

const isDevMode = mode !== 'production';
const isDevServer = process.argv[1].includes('webpack-dev-server');
const disableTypeCheck = ['1', 'true'].includes(
  String(process.env.DISABLE_TYPE_CHECK || '').toLowerCase(),
);

// TypeScript checker memory limit (in MB)
const TYPESCRIPT_MEMORY_LIMIT = 8192;

const output = {
  path: BUILD_DIR,
  publicPath: '/static/assets/',
};
if (isDevMode) {
  output.filename = '[name].[contenthash:8].entry.js';
  output.chunkFilename = '[name].[contenthash:8].chunk.js';
} else if (nameChunks) {
  output.filename = '[name].[chunkhash].entry.js';
  output.chunkFilename = '[name].[chunkhash].chunk.js';
} else {
  output.filename = '[name].[chunkhash].entry.js';
  output.chunkFilename = '[chunkhash].chunk.js';
}

if (!isDevMode) {
  output.clean = true;
}

const plugins = [
  new webpack.ProvidePlugin({
    process: 'process/browser.js',
    ...(isDevMode ? { Buffer: ['buffer', 'Buffer'] } : {}), // Fix legacy-plugin-chart-paired-t-test broken Story
  }),
  new webpack.NormalModuleReplacementPlugin(/^node:/, resource => {
    resource.request = resource.request.replace(/^node:/, '');
  }),

  // creates a manifest.json mapping of name to hashed output used in template files
  new WebpackManifestPlugin({
    publicPath: output.publicPath,
    seed: { app: 'superset' },
    // This enables us to include all relevant files for an entry
    generate: (seed, files, entrypoints) => {
      // Each entrypoint's chunk files in the format of
      // {
      //   entry: {
      //     css: [],
      //     js: []
      //   }
      // }
      const entryFiles = {};
      Object.entries(entrypoints).forEach(([entry, chunks]) => {
        entryFiles[entry] = {
          css: chunks
            .filter(x => x.endsWith('.css'))
            .map(x => `${output.publicPath}${x}`),
          js: chunks
            .filter(x => x.endsWith('.js') && x.match(/(?<!hot-update).js$/))
            .map(x => `${output.publicPath}${x}`),
        };
      });
      return {
        ...seed,
        entrypoints: entryFiles,
      };
    },
    // Also write manifest.json to disk when running `npm run dev`.
    // This is required for Flask to work.
    writeToFileEmit: isDevMode && !isDevServer,
  }),

  // expose mode variable to other modules
  new webpack.DefinePlugin({
    'process.env.WEBPACK_MODE': JSON.stringify(mode),
    'process.env.REDUX_DEFAULT_MIDDLEWARE':
      process.env.REDUX_DEFAULT_MIDDLEWARE,
    'process.env.SCARF_ANALYTICS': JSON.stringify(process.env.SCARF_ANALYTICS),
  }),

  new CopyPlugin({
    patterns: ['package.json', { from: 'src/assets/images', to: 'images' }],
  }),

  // static pages
  new HtmlWebpackPlugin({
    template: './src/assets/staticPages/404.html',
    inject: true,
    chunks: [],
    filename: '404.html',
  }),
  new HtmlWebpackPlugin({
    template: './src/assets/staticPages/500.html',
    inject: true,
    chunks: [],
    filename: '500.html',
  }),
  new ModuleFederationPlugin({
    name: 'superset',
    filename: 'remoteEntry.js',
    shared: {
      react: {
        singleton: true,
        eager: true,
        requiredVersion: packageConfig.dependencies.react,
      },
      'react-dom': {
        singleton: true,
        eager: true,
        requiredVersion: packageConfig.dependencies['react-dom'],
      },
      antd: {
        singleton: true,
        requiredVersion: packageConfig.dependencies.antd,
        eager: true,
      },
    },
  }),
];

if (!process.env.CI) {
  plugins.push(new webpack.ProgressPlugin());
}

if (!isDevMode) {
  // text loading (webpack 4+)
  plugins.push(
    new MiniCssExtractPlugin({
      filename: '[name].[chunkhash].entry.css',
      chunkFilename: '[name].[chunkhash].chunk.css',
    }),
  );
}

// Type checking for both dev and production
// In dev mode, this provides real-time type checking and builds .d.ts files for plugins
// Can be disabled with DISABLE_TYPE_CHECK=true npm run dev
if (isDevMode) {
  if (disableTypeCheck) {
    console.log('⚡ Type checking disabled (DISABLE_TYPE_CHECK=true)');
  } else {
    console.log(
      '✅ Type checking enabled (disable with DISABLE_TYPE_CHECK=true npm run dev)',
    );
    // Optimized configuration for development - much faster type checking
    plugins.push(
      new ForkTsCheckerWebpackPlugin({
        typescript: {
          memoryLimit: TYPESCRIPT_MEMORY_LIMIT,
          build: true, // Generate .d.ts files
          mode: 'write-references', // Handle project references properly
          // Use main tsconfig but with safe performance optimizations
          configOverwrite: {
            compilerOptions: {
              // Only safe optimizations that won't cause errors
              skipLibCheck: true, // Skip checking .d.ts files - safe and huge perf boost
              incremental: true, // Enable incremental compilation
            },
          },
        },
        // Logger configuration
        logger: 'webpack-infrastructure',
        async: true, // Non-blocking type checking
        // Only check files that webpack is actually processing
        // This dramatically reduces the scope of type checking
        issue: {
          scope: 'webpack', // Only check files in webpack's module graph, not entire project
          include: [
            { file: 'src/**/*.{ts,tsx}' },
            { file: 'packages/*/src/**/*.{ts,tsx}' },
            { file: 'plugins/*/src/**/*.{ts,tsx}' },
          ],
          exclude: [{ file: '**/node_modules/**' }],
        },
      }),
    );
  }
} else {
  if (disableTypeCheck) {
    console.log('⚡ Type checking disabled for production build');
  } else {
    // Production mode - full type checking
    plugins.push(
      new ForkTsCheckerWebpackPlugin({
        typescript: {
          memoryLimit: TYPESCRIPT_MEMORY_LIMIT,
          build: true,
          mode: 'write-references',
        },
        // Logger configuration
        logger: 'webpack-infrastructure',
        issue: {
          exclude: [{ file: '**/node_modules/**' }],
        },
      }),
    );
  }
}

const PREAMBLE = [path.join(APP_DIR, '/src/preamble.ts')];
// Note: webpack-dev-server v4 auto-injects its HMR client with the correct
// webSocketURL (port 9000) from devServer.client config. We no longer manually
// add the client to PREAMBLE — that approach used a legacy query-string URL
// that fell back to auto-detecting from window.location, causing it to try
// ws://localhost:8088/ws when browsing the Flask server on port 8088.

function addPreamble(entry) {
  return PREAMBLE.concat([path.join(APP_DIR, entry)]);
}

const babelLoader = {
  loader: 'babel-loader',
  options: {
    cacheDirectory: true,
    // disable gzip compression for cache files
    // faster when there are millions of small files
    cacheCompression: false,
    presets: [
      [
        '@babel/preset-react',
        {
          runtime: 'automatic',
          importSource: '@emotion/react',
        },
      ],
    ],
    plugins: [
      [
        '@emotion/babel-plugin',
        {
          autoLabel: 'dev-only',
          labelFormat: '[local]',
        },
      ],
    ],
  },
};

const config = {
  entry: {
    preamble: PREAMBLE,
    theme: path.join(APP_DIR, '/src/theme.ts'),
    menu: addPreamble('src/views/menu.tsx'),
    spa: addPreamble('/src/views/index.tsx'),
    embedded: addPreamble('/src/embedded/index.tsx'),
  },
  cache: {
    type: 'filesystem', // Enable filesystem caching
    cacheDirectory: path.resolve(__dirname, '.temp_cache'),
    buildDependencies: {
      config: [__filename],
    },
  },
  output,
  stats: 'minimal',
  /*
   Silence warning for missing export in @data-ui's internal structure. This
   issue arises from an internal implementation detail of @data-ui. As it's
   non-critical, we suppress it to prevent unnecessary clutter in the build
   output. For more context, refer to:
   https://github.com/williaster/data-ui/issues/208#issuecomment-946966712
   */
  ignoreWarnings: [
    {
      message:
        /export 'withTooltipPropTypes' \(imported as 'vxTooltipPropTypes'\) was not found/,
    },
    {
      message: /Can't resolve.*superset_text/,
    },
    // Suppress node: scheme warnings from lazy-imported export libs (docx, pptxgenjs)
    {
      message: /Can't resolve 'node:/,
    },
    // Suppress critical dependency warnings from dynamic requires in third-party libs
    {
      message: /Critical dependency: the request of a dependency is an expression/,
    },
  ],
  performance: {
    hints: false,
    assetFilter(assetFilename) {
      // don't throw size limit warning on geojson and font files
      return !/\.(map|geojson|woff2)$/.test(assetFilename);
    },
  },
  optimization: {
    sideEffects: true,
    splitChunks: {
      chunks: 'all',
      // increase minSize for devMode to 1000kb because of sourcemap
      minSize: isDevMode ? 1000000 : 20000,
      name: nameChunks,
      automaticNameDelimiter: '-',
      minChunks: 2,
      cacheGroups: {
        automaticNamePrefix: 'chunk',
        // basic stable dependencies
        vendors: {
          priority: 50,
          name: 'vendors',
          test: new RegExp(
            `/node_modules/(${[
              'react',
              'react-dom',
              'prop-types',
              'react-prop-types',
              'prop-types-extra',
              'redux',
              'react-redux',
              'react-hot-loader',
              'react-sortable-hoc',
              'react-table',
              'react-ace',
              '@hot-loader.*',
              'webpack.*',
              '@?babel.*',
              'lodash.*',
              'antd',
              '@ant-design.*',
              '.*bootstrap',
              'moment',
              'jquery',
              'core-js.*',
              '@emotion.*',
              'd3',
              'd3-(array|color|scale|interpolate|format|selection|collection|time|time-format)',
            ].join('|')})/`,
          ),
        },
        // viz thumbnails are used in `addSlice` and `explore` page
        thumbnail: {
          name: 'thumbnail',
          test: /thumbnail(Large)?\.(png|jpg)/i,
          priority: 20,
          enforce: true,
        },
      },
    },
    usedExports: 'global',
    minimizer: [new CssMinimizerPlugin(), '...'],
  },
  resolve: {
    // resolve modules from `/superset_frontend/node_modules` and `/superset_frontend`
    modules: [
      'node_modules',
      APP_DIR,
      path.resolve(APP_DIR, 'packages'),
      path.resolve(APP_DIR, 'plugins'),
    ],
    alias: {
      react: path.resolve(path.join(APP_DIR, './node_modules/react')),
      // Some lazily imported export libraries reference Node built-ins using the
      // `node:` scheme. Mark them as unavailable in the browser bundle so webpack
      // doesn't fail the entire frontend build while processing those chunks.
      'node:fs': false,
      'node:https': false,
      'node:path': false,
      'node:stream': require.resolve('stream-browserify'),
      'node:vm': require.resolve('vm-browserify'),
      // TODO: remove Handlebars alias once Handlebars NPM package has been updated to
      // correctly support webpack import (https://github.com/handlebars-lang/handlebars.js/issues/953)
      handlebars: 'handlebars/dist/handlebars.js',
      /*
      Temporary workaround to prevent Webpack from resolving moment locale
      files, which are unnecessary for this project and causing build warnings.
      This prevents "Module not found" errors for moment locale files.
      */
      'moment/min/moment-with-locales': false,
      // Temporary workaround to allow Storybook 8 to work with existing React v16-compatible stories.
      // Remove below alias once React has been upgreade to v18.
      '@storybook/react-dom-shim': path.resolve(
        path.join(
          APP_DIR,
          './node_modules/@storybook/react-dom-shim/dist/react-16',
        ),
      ),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.yml'],
    fallback: {
      fs: false,
      https: false,
      vm: require.resolve('vm-browserify'),
      path: false,
      stream: require.resolve('stream-browserify'),
      ...(isDevMode ? { buffer: require.resolve('buffer/') } : {}), // Fix legacy-plugin-chart-paired-t-test broken Story
    },
  },
  context: APP_DIR, // to automatically find tsconfig.json
  module: {
    rules: [
      {
        test: /datatables\.net.*/,
        loader: 'imports-loader',
        options: {
          additionalCode: 'var define = false;',
        },
      },
      {
        test: /node_modules\/(@deck\.gl|@luma\.gl).*\.js$/,
        loader: 'imports-loader',
        options: {
          additionalCode: 'var module = module || {exports: {}};',
        },
      },
      {
        test: /\.tsx?$/,
        exclude: [/\.test.tsx?$/],
        use: [
          'thread-loader',
          babelLoader,
          {
            loader: 'ts-loader',
            options: {
              // transpile only in happyPack mode
              // type checking is done via fork-ts-checker-webpack-plugin
              happyPackMode: true,
              transpileOnly: true,
              // must override compiler options here, even though we have set
              // the same options in `tsconfig.json`, because they may still
              // be overridden by `tsconfig.json` in node_modules subdirectories.
              compilerOptions: {
                esModuleInterop: false,
                importHelpers: false,
                module: 'esnext',
                target: 'esnext',
              },
            },
          },
        ],
      },
      {
        test: /\.jsx?$/,
        // include source code for plugins, but exclude node_modules and test files within them
        exclude: [/superset-ui.*\/node_modules\//, /\.test.jsx?$/],
        include: [
          new RegExp(`${APP_DIR}/(src|.storybook|plugins|packages)`),
          ...['./src', './.storybook', './plugins', './packages'].map(p =>
            path.resolve(__dirname, p),
          ), // redundant but required for windows
          /@encodable/,
        ],
        use: [babelLoader],
      },
      {
        test: /ace-builds.*\/worker-.*$/,
        type: 'asset/resource',
      },
      // react-hot-loader use "ProxyFacade", which is a wrapper for react Component
      // see https://github.com/gaearon/react-hot-loader/issues/1311
      // TODO: refactor recurseReactClone
      {
        test: /\.js$/,
        include: /node_modules\/react-dom/,
        use: ['react-hot-loader/webpack'],
      },
      {
        test: /\.css$/,
        include: [APP_DIR, /superset-ui.+\/src/],
        exclude: /node_modules/,
        use: [
          isDevMode
            ? 'style-loader'
            : {
                loader: MiniCssExtractPlugin.loader,
                options: {
                  publicPath: MINI_CSS_EXTRACT_PUBLICPATH,
                },
              },
          {
            loader: 'css-loader',
            options: {
              sourceMap: true,
            },
          },
        ],
      },
      /* for CSS from node_modules (leaflet, geostyler, fontsource, etc.) */
      {
        test: /\.css$/,
        include: /node_modules/,
        use: [
          isDevMode
            ? 'style-loader'
            : {
                loader: MiniCssExtractPlugin.loader,
                options: {
                  publicPath: MINI_CSS_EXTRACT_PUBLICPATH,
                },
              },
          {
            loader: 'css-loader',
            options: {
              sourceMap: false,
            },
          },
        ],
      },
      /* for css linking images (and viz plugin thumbnails) */
      {
        test: /\.png$/,
        issuer: {
          not: [/\/src\/assets\/staticPages\//],
        },
        type: 'asset',
        generator: {
          filename: '[name].[contenthash:8][ext]',
        },
      },
      {
        test: /\.png$/,
        issuer: /\/src\/assets\/staticPages\//,
        type: 'asset',
      },
      {
        test: /\.svg(\?v=\d+\.\d+\.\d+)?$/,
        issuer: /\.([jt])sx?$/,
        use: [
          {
            loader: '@svgr/webpack',
            options: {
              titleProp: true,
              ref: true,
              // this is the default value for the icon. Using other values
              // here will replace width and height in svg with 1em
              icon: false,
            },
          },
        ],
      },
      {
        test: /\.(jpg|gif)$/,
        type: 'asset/resource',
        generator: {
          filename: '[name].[contenthash:8][ext]',
        },
      },
      /* for font-awesome */
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
      {
        test: /\.ya?ml$/,
        include: ROOT_DIR,
        loader: 'js-yaml-loader',
      },
      {
        test: /\.geojson$/,
        type: 'asset/resource',
      },
      // {
      //   test: /\.mdx?$/,
      //   use: [
      //     {
      //       loader: require.resolve('@storybook/mdx2-csf/loader'),
      //       options: {
      //         skipCsf: false,
      //         mdxCompileOptions: {
      //           remarkPlugins: [remarkGfm],
      //         },
      //       },
      //     },
      //   ],
      // },
    ],
  },
  externals: {
    cheerio: 'window',
    'react/lib/ExecutionEnvironment': true,
    'react/lib/ReactContext': true,
  },
  plugins,
  devtool: isDevMode ? 'eval-cheap-module-source-map' : false,
  watchOptions: isDevMode
    ? {
        // Watch all plugin and package source directories
        ignored: ['**/node_modules', '**/.git', '**/lib', '**/esm', '**/dist'],
        // Use native filesystem events (fsevents on macOS, inotify on Linux)
        // instead of polling — much faster change detection
        poll: false,
        // Aggregate changes for 300ms before rebuilding
        aggregateTimeout: 300,
      }
    : undefined,
};

// find all the symlinked plugins and use their source code for imports
Object.entries(packageConfig.dependencies).forEach(([pkg, relativeDir]) => {
  const srcPath = path.join(APP_DIR, `./node_modules/${pkg}/src`);
  const dir = relativeDir.replace('file:', '');

  if (
    (/^@superset-ui/.test(pkg) || /^@apache-superset/.test(pkg)) &&
    fs.existsSync(srcPath)
  ) {
    console.log(`[Superset Plugin] Use symlink source for ${pkg} @ ${dir}`);
    config.resolve.alias[pkg] = path.resolve(APP_DIR, `${dir}/src`);
  }
});
console.log(''); // pure cosmetic new line

if (isDevMode) {
  let proxyConfig = getProxyConfig();
  // Set up a plugin to handle manifest updates
  config.plugins = config.plugins || [];
  config.plugins.push({
    apply: compiler => {
      const { afterEmit } = getCompilerHooks(compiler);
      afterEmit.tap('ManifestPlugin', manifest => {
        proxyConfig = getProxyConfig(manifest);
      });
    },
  });

  config.devServer = {
    devMiddleware: {
      writeToDisk: true,
    },
    historyApiFallback: true,
    hot: true,
    liveReload: false,
    webSocketServer: 'ws',
    host: devserverHost,
    port: devserverPort,
    allowedHosts: ['localhost', '.localhost', '127.0.0.1', '::1', '.local'],
    proxy: [() => proxyConfig],
    client: {
      webSocketURL: {
        protocol: 'ws',
        hostname: ['0.0.0.0', '127.0.0.1'].includes(devserverHost)
          ? 'localhost'
          : devserverHost,
        port: devserverPort,
        pathname: '/ws',
      },
      overlay: false,
      progress: true,
    },
    static: {
      directory: path.join(process.cwd(), '../static/assets'),
    },
  };
}

// To
// e.g. npm run package-stats
if (process.env.BUNDLE_ANALYZER) {
  config.plugins.push(new BundleAnalyzerPlugin({ analyzerMode: 'static' }));
  config.plugins.push(
    // this creates an HTML page with a sunburst diagram of dependencies.
    // you'll find it at superset/static/stats/statistics.html
    // note that the file is >100MB so it's in .gitignore
    new Visualizer({
      filename: path.join('..', 'stats', 'statistics.html'),
      throwOnError: true,
    }),
  );
}

// Speed measurement is disabled by default
// Pass flag --measure=true to enable
// e.g. npm run build -- --measure=true
const smp = new SpeedMeasurePlugin({
  disable: !measure,
});

module.exports = smp.wrap(config);
