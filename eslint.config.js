module.exports = [
    {
        ignores: ["node_modules/", "public/"]
    },
    {
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: "commonjs"
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "warn"
        }
    }
];