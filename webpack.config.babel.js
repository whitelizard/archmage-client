// import webpack from 'webpack';
import path from 'path';

const PATHS = {
  src: path.resolve('./src'),
  lib: path.resolve('./lib'),
  modules: path.resolve('./node_modules'),
};

export default {
  context: __dirname,
  module: {
    loaders: [
      {
        test: /\.js$/,
        loader: 'babel-loader',
        exclude: [PATHS.modules],
      },
    ],
  },
  resolve: {
    modulesDirectories: [
      'node_modules',
    ],
    root: [PATHS.src],
    extensions: ['', '.js'],
  },
  resolveLoader: {
    root: PATHS.modules,
  },
  entry: './src/archmage-session.js',
  output: {
    path: PATHS.lib,
    filename: 'index.js',
  },
};
