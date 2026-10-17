"""Load the mobile ACP extension in this explicitly scoped Hermes process."""
import importlib.abc
import importlib.machinery
import importlib.util
import os
from pathlib import Path
import sys

if os.environ.get("CMC_HERMES_ACP_EXTENSION") == "1":
    class _MobileLoader(importlib.abc.Loader):
        def __init__(self, loader):
            self.loader = loader

        def create_module(self, spec):
            return self.loader.create_module(spec)

        def exec_module(self, module):
            self.loader.exec_module(module)
            extension = Path(__file__).with_name("hermes_mobile_adapter.py")
            spec = importlib.util.spec_from_file_location("cmc_hermes_mobile_adapter", extension)
            adapter = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(adapter)
            adapter.install(module.HermesACPAgent)

    class _MobileFinder(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path=None, target=None):
            if fullname != "acp_adapter.server":
                return None
            spec = importlib.machinery.PathFinder.find_spec(fullname, path, target)
            if spec is not None:
                spec.loader = _MobileLoader(spec.loader)
            return spec

    sys.meta_path.insert(0, _MobileFinder())
