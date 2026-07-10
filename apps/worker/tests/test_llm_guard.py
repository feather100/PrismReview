import os
import sys
import unittest

# Adjust path to import from src
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.llm_guard import get_allowed_model_provider, ModelGuardError

class TestLLMGuard(unittest.TestCase):
    def setUp(self):
        # Clear specific env vars before each test
        for key in ["MODEL_PROVIDER", "ALLOW_EXTERNAL_MODEL_CALLS", "ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL"]:
            if key in os.environ:
                del os.environ[key]
                
    def test_default_is_mock(self):
        # By default, mock should be returned
        self.assertEqual(get_allowed_model_provider("test_tenant", False), "mock")
        
    def test_external_provider_rejected_by_default(self):
        # Set provider to openai but don't enable the switch
        os.environ["MODEL_PROVIDER"] = "openai"
        with self.assertRaises(ModelGuardError) as context:
            get_allowed_model_provider("test_tenant", False)
        self.assertIn("disabled by default", str(context.exception))
        
    def test_external_provider_allowed_with_flags(self):
        os.environ["MODEL_PROVIDER"] = "openai"
        os.environ["ALLOW_EXTERNAL_MODEL_CALLS"] = "true"
        os.environ["ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL"] = "true"
        
        # Test tenant + desensitized = True -> allowed
        self.assertEqual(get_allowed_model_provider("test_tenant", True), "openai")
        
        # Test tenant + real doc (allowed by flag) -> allowed
        self.assertEqual(get_allowed_model_provider("test_tenant", False), "openai")
        
    def test_external_provider_rejects_non_test_tenant(self):
        os.environ["MODEL_PROVIDER"] = "openai"
        os.environ["ALLOW_EXTERNAL_MODEL_CALLS"] = "true"
        
        with self.assertRaises(ModelGuardError) as context:
            get_allowed_model_provider("prod_tenant", True)
        self.assertIn("restricted to 'test_tenant' only", str(context.exception))
        
    def test_external_provider_rejects_real_docs_without_flag(self):
        os.environ["MODEL_PROVIDER"] = "openai"
        os.environ["ALLOW_EXTERNAL_MODEL_CALLS"] = "true"
        os.environ["ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL"] = "false"
        
        with self.assertRaises(ModelGuardError) as context:
            get_allowed_model_provider("test_tenant", False)
        self.assertIn("Cannot send real documents to external models", str(context.exception))

if __name__ == '__main__':
    unittest.main()
