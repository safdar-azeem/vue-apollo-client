// vite.config.ts
import { defineConfig } from "file:///Users/safdar/Projects/erp-new/vue-apollo-client/node_modules/vite/dist/node/index.js";
import path from "path";
import { fileURLToPath } from "node:url";
import dts from "file:///Users/safdar/Projects/erp-new/vue-apollo-client/node_modules/vite-plugin-dts/dist/index.mjs";
var __vite_injected_original_import_meta_url = "file:///Users/safdar/Projects/erp-new/vue-apollo-client/vite.config.ts";
var root = fileURLToPath(new URL(".", __vite_injected_original_import_meta_url));
var vite_config_default = defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true
    })
  ],
  build: {
    lib: {
      entry: {
        "vue-apollo-client": path.resolve(root, "src/index.ts"),
        vite: path.resolve(root, "src/vite/index.ts")
      },
      name: "VueApolloClient",
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const ext = format === "es" ? "mjs" : "cjs";
        if (entryName === "vite") {
          return `vite.${ext}`;
        }
        return `vue-apollo-client.${ext}`;
      }
    },
    rollupOptions: {
      external: [
        /^node:/,
        /^@apollo\/client(?:\/.*)?$/,
        "@vue/apollo-composable",
        "vue",
        "vue-router",
        "graphql",
        "graphql-tag",
        "@graphql-codegen/cli",
        "vite",
        "path",
        "fs",
        "module"
      ],
      // Mark node-deps external
      output: {
        globals: {
          vue: "Vue",
          "vue-router": "VueRouter",
          graphql: "GraphQL"
        }
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvc2FmZGFyL1Byb2plY3RzL2VycC1uZXcvdnVlLWFwb2xsby1jbGllbnRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9zYWZkYXIvUHJvamVjdHMvZXJwLW5ldy92dWUtYXBvbGxvLWNsaWVudC92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvc2FmZGFyL1Byb2plY3RzL2VycC1uZXcvdnVlLWFwb2xsby1jbGllbnQvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCdcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCdcbmltcG9ydCBkdHMgZnJvbSAndml0ZS1wbHVnaW4tZHRzJ1xuXG5jb25zdCByb290ID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuJywgaW1wb3J0Lm1ldGEudXJsKSlcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW1xuICAgIGR0cyh7XG4gICAgICBpbnNlcnRUeXBlc0VudHJ5OiB0cnVlLFxuICAgIH0pLFxuICBdLFxuICBidWlsZDoge1xuICAgIGxpYjoge1xuICAgICAgZW50cnk6IHtcbiAgICAgICAgJ3Z1ZS1hcG9sbG8tY2xpZW50JzogcGF0aC5yZXNvbHZlKHJvb3QsICdzcmMvaW5kZXgudHMnKSxcbiAgICAgICAgdml0ZTogcGF0aC5yZXNvbHZlKHJvb3QsICdzcmMvdml0ZS9pbmRleC50cycpLFxuICAgICAgfSxcbiAgICAgIG5hbWU6ICdWdWVBcG9sbG9DbGllbnQnLFxuICAgICAgZm9ybWF0czogWydlcycsICdjanMnXSxcbiAgICAgIGZpbGVOYW1lOiAoZm9ybWF0LCBlbnRyeU5hbWUpID0+IHtcbiAgICAgICAgY29uc3QgZXh0ID0gZm9ybWF0ID09PSAnZXMnID8gJ21qcycgOiAnY2pzJ1xuICAgICAgICBpZiAoZW50cnlOYW1lID09PSAndml0ZScpIHtcbiAgICAgICAgICByZXR1cm4gYHZpdGUuJHtleHR9YFxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBgdnVlLWFwb2xsby1jbGllbnQuJHtleHR9YFxuICAgICAgfSxcbiAgICB9LFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIGV4dGVybmFsOiBbXG4gICAgICAgIC9ebm9kZTovLFxuICAgICAgICAvXkBhcG9sbG9cXC9jbGllbnQoPzpcXC8uKik/JC8sXG4gICAgICAgICdAdnVlL2Fwb2xsby1jb21wb3NhYmxlJyxcbiAgICAgICAgJ3Z1ZScsXG4gICAgICAgICd2dWUtcm91dGVyJyxcbiAgICAgICAgJ2dyYXBocWwnLFxuICAgICAgICAnZ3JhcGhxbC10YWcnLFxuICAgICAgICAnQGdyYXBocWwtY29kZWdlbi9jbGknLFxuICAgICAgICAndml0ZScsXG4gICAgICAgICdwYXRoJyxcbiAgICAgICAgJ2ZzJyxcbiAgICAgICAgJ21vZHVsZScsXG4gICAgICBdLCAvLyBNYXJrIG5vZGUtZGVwcyBleHRlcm5hbFxuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIGdsb2JhbHM6IHtcbiAgICAgICAgICB2dWU6ICdWdWUnLFxuICAgICAgICAgICd2dWUtcm91dGVyJzogJ1Z1ZVJvdXRlcicsXG4gICAgICAgICAgZ3JhcGhxbDogJ0dyYXBoUUwnLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxufSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBa1UsU0FBUyxvQkFBb0I7QUFDL1YsT0FBTyxVQUFVO0FBQ2pCLFNBQVMscUJBQXFCO0FBQzlCLE9BQU8sU0FBUztBQUh3TCxJQUFNLDJDQUEyQztBQUt6UCxJQUFNLE9BQU8sY0FBYyxJQUFJLElBQUksS0FBSyx3Q0FBZSxDQUFDO0FBRXhELElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVM7QUFBQSxJQUNQLElBQUk7QUFBQSxNQUNGLGtCQUFrQjtBQUFBLElBQ3BCLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxLQUFLO0FBQUEsTUFDSCxPQUFPO0FBQUEsUUFDTCxxQkFBcUIsS0FBSyxRQUFRLE1BQU0sY0FBYztBQUFBLFFBQ3RELE1BQU0sS0FBSyxRQUFRLE1BQU0sbUJBQW1CO0FBQUEsTUFDOUM7QUFBQSxNQUNBLE1BQU07QUFBQSxNQUNOLFNBQVMsQ0FBQyxNQUFNLEtBQUs7QUFBQSxNQUNyQixVQUFVLENBQUMsUUFBUSxjQUFjO0FBQy9CLGNBQU0sTUFBTSxXQUFXLE9BQU8sUUFBUTtBQUN0QyxZQUFJLGNBQWMsUUFBUTtBQUN4QixpQkFBTyxRQUFRLEdBQUc7QUFBQSxRQUNwQjtBQUNBLGVBQU8scUJBQXFCLEdBQUc7QUFBQSxNQUNqQztBQUFBLElBQ0Y7QUFBQSxJQUNBLGVBQWU7QUFBQSxNQUNiLFVBQVU7QUFBQSxRQUNSO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxNQUNGO0FBQUE7QUFBQSxNQUNBLFFBQVE7QUFBQSxRQUNOLFNBQVM7QUFBQSxVQUNQLEtBQUs7QUFBQSxVQUNMLGNBQWM7QUFBQSxVQUNkLFNBQVM7QUFBQSxRQUNYO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
