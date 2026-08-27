# openfox-openrouter-free
OpenFox plugin for the OpenRouter provider focused on **free models only**, with an automatic hourly update system (1x per hour).

## Features
- **OpenRouter (Free Models) Provider** integrated into OpenFox.
- **Automatic filtering**: Only free OpenRouter models (`pricing.prompt == "0"` and `pricing.completion == "0"`) are retrieved.
- **Hourly updates (1x/hour)**:
  - Automatic addition of new free models as soon as they appear.
  - Automatic removal of models that are discontinued or become paid.
- **1-Click OAuth / API Key Authentication**: Quick connection with your OpenRouter account (or via the `OPENROUTER_API_KEY` variable) for managing rate limits and requests.
- **Full support for OpenFox features**: Streaming, tool calls, thinking/reasoning.

## Installation
In OpenFox's plugins directory (`~/.openfox/plugins/` or via the registry):
```bash
npm install openfox-openrouter-free
```

## Usage
1. Enable the **OpenRouter (Free Models)** provider in OpenFox.
2. Click **Connect OpenRouter** to authenticate with your OpenRouter account in one click (or set the `OPENROUTER_API_KEY` environment variable).
3. Enjoy OpenRouter's free models, updated every hour.

## License
MIT
